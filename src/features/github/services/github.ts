import { DEFAULT_MAIN_CATEGORY_ID } from '@constants'
import { getRemoteBaseUrl } from '@core/data/adapters/remoteDb'
import type { GitHubRepoCard, RepoActivityItem, RepoDetailData } from '@shared/types'
import { buildSummary } from '@utils/summary'

type GitHubRepoResponse = {
  full_name: string
  owner: { login: string }
  name: string
  description: string | null
  html_url: string
  homepage: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  subscribers_count: number
  open_issues_count: number
  topics?: string[]
  license: { spdx_id: string | null; name: string } | null
  default_branch: string
  created_at: string
  updated_at: string
}

type GitHubReadmeResponse = {
  content: string
  encoding: string
}

type GitHubCommitResponse = {
  sha: string
  html_url: string
  commit: {
    message: string
    author: {
      name: string
      date: string
    }
  }
  author: {
    login: string
  } | null
}

type GitHubIssueResponse = {
  id: number
  title: string
  html_url: string
  updated_at: string
  user: {
    login: string
  }
  pull_request?: {
    html_url: string
  }
}

type GithubSummaryApiResult = {
  jobId: number | null
  summaryJobStatus: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'dead'
  summaryText: string
  summaryStatus: 'idle' | 'queued' | 'ready' | 'failed'
  summaryUpdatedAt: string | null
  summaryProvider: 'glm' | 'none'
  summaryError: string | null
}

export class GitHubApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
  }
}

const githubToken = import.meta.env.VITE_GITHUB_TOKEN as string | undefined
const githubTimeoutSecondsRaw = import.meta.env.VITE_GITHUB_TIMEOUT_SECONDS as string | undefined
const githubTimeoutMs = (() => {
  const parsed = Number(githubTimeoutSecondsRaw ?? '')
  const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 12
  return Math.floor(seconds * 1000)
})()
const remoteApiToken = (import.meta.env.VITE_POSTGRES_SYNC_API_TOKEN as string | undefined)?.trim() ?? ''

const createHeaders = (): HeadersInit => {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
  }

  if (githubToken && githubToken.trim()) {
    headers.Authorization = `Bearer ${githubToken.trim()}`
  }

  return headers
}

const buildErrorMessage = async (response: Response): Promise<string> => {
  let payload: { message?: string } = {}

  try {
    payload = (await response.json()) as { message?: string }
  } catch {
    payload = {}
  }

  if (response.status === 404) {
    return '저장소를 찾을 수 없습니다. URL의 owner/repo 경로를 확인해 주세요.'
  }

  if (response.status === 403) {
    if ((payload.message ?? '').toLowerCase().includes('rate limit')) {
      return 'GitHub API 요청 제한에 도달했습니다. VITE_GITHUB_TOKEN 설정을 권장합니다.'
    }

    return '이 저장소 정보에 접근할 수 없습니다.'
  }

  if (!navigator.onLine) {
    return '네트워크 연결이 끊어졌습니다. 연결 상태를 확인해 주세요.'
  }

  return payload.message ? `GitHub API 오류: ${payload.message}` : `GitHub API 요청 실패 (${response.status})`
}

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), githubTimeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

const decodeBase64Utf8 = (value: string): string => {
  const cleaned = value.replace(/\n/g, '')
  const binary = atob(cleaned)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const readmePreview = (readme: string | null): string | null => {
  if (!readme) {
    return null
  }

  const lines = readme
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())

  const sliced = lines.slice(0, 80)
  const preview = sliced.join('\n').trim()

  return preview || null
}

const mapCommitActivity = (items: GitHubCommitResponse[]): RepoActivityItem[] =>
  items.map((item) => ({
    id: item.sha,
    type: 'commit',
    title: item.commit.message.split('\n')[0].trim() || '(no commit message)',
    url: item.html_url,
    author: item.author?.login ?? item.commit.author.name,
    createdAt: item.commit.author.date,
  }))

const mapIssueActivity = (items: GitHubIssueResponse[]): RepoActivityItem[] =>
  items.map((item) => ({
    id: String(item.id),
    type: item.pull_request ? 'pull_request' : 'issue',
    title: item.title,
    url: item.html_url,
    author: item.user.login,
    createdAt: item.updated_at,
  }))

const isGitHubError = (value: unknown): value is GitHubApiError => value instanceof GitHubApiError

const fetchJson = async <T>(url: string): Promise<T> => {
  let response: Response

  try {
    response = await fetchWithTimeout(url, {
      headers: createHeaders(),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new GitHubApiError('요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.', 408)
    }

    throw error
  }

  if (!response.ok) {
    const message = await buildErrorMessage(response)
    throw new GitHubApiError(message, response.status)
  }

  return (await response.json()) as T
}

export const fetchLatestCommitSha = async (owner: string, repo: string): Promise<string | null> => {
  const commits = await fetchJson<GitHubCommitResponse[]>(
    `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`,
  )

  return commits[0]?.sha ?? null
}

export const fetchReadme = async (owner: string, repo: string): Promise<string | null> => {
  let response: Response

  try {
    response = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: createHeaders(),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null
    }

    throw error
  }

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const message = await buildErrorMessage(response)
    throw new GitHubApiError(message, response.status)
  }

  const payload = (await response.json()) as GitHubReadmeResponse

  if (payload.encoding !== 'base64' || !payload.content) {
    return null
  }

  return decodeBase64Utf8(payload.content)
}

export const fetchRepo = async (owner: string, repo: string): Promise<GitHubRepoCard> => {
  const payload = await fetchJson<GitHubRepoResponse>(`https://api.github.com/repos/${owner}/${repo}`)

  let readme: string | null = null

  try {
    readme = await fetchReadme(owner, repo)
  } catch {
    readme = null
  }

  const description = payload.description ?? ''
  const summary = buildSummary(description, readme)

  return {
    id: payload.full_name.toLowerCase(),
    categoryId: DEFAULT_MAIN_CATEGORY_ID,
    owner: payload.owner.login,
    repo: payload.name,
    fullName: payload.full_name,
    description,
    summary,
    htmlUrl: payload.html_url,
    homepage: payload.homepage,
    language: payload.language,
    stars: payload.stargazers_count,
    forks: payload.forks_count,
    watchers: payload.subscribers_count,
    openIssues: payload.open_issues_count,
    topics: payload.topics ?? [],
    license: payload.license?.spdx_id ?? payload.license?.name ?? null,
    defaultBranch: payload.default_branch,
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    addedAt: new Date().toISOString(),
    summaryStatus: summary.trim() ? 'ready' : 'idle',
    summaryProvider: 'none',
    summaryUpdatedAt: null,
    summaryError: null,
  }
}

const resolveGithubSummaryApiResult = (payload: Record<string, unknown>): GithubSummaryApiResult => {
  const summaryText = typeof payload.summaryText === 'string' ? payload.summaryText : ''
  const summaryJobStatus: GithubSummaryApiResult['summaryJobStatus'] =
    payload.summaryJobStatus === 'queued' ||
    payload.summaryJobStatus === 'running' ||
    payload.summaryJobStatus === 'succeeded' ||
    payload.summaryJobStatus === 'failed' ||
    payload.summaryJobStatus === 'dead'
      ? payload.summaryJobStatus
      : 'idle'

  let summaryStatus: GithubSummaryApiResult['summaryStatus'] =
    payload.summaryStatus === 'queued' ||
    payload.summaryStatus === 'ready' ||
    payload.summaryStatus === 'failed'
      ? payload.summaryStatus
      : summaryText.trim()
        ? 'ready'
        : 'idle'

  // Some server versions can return queued even after succeeded.
  if (summaryJobStatus === 'succeeded' && summaryStatus === 'queued') {
    summaryStatus = summaryText.trim() ? 'ready' : 'queued'
  }

  if ((summaryJobStatus === 'failed' || summaryJobStatus === 'dead') && summaryStatus === 'queued') {
    summaryStatus = 'failed'
  }

  return {
    jobId: typeof payload.jobId === 'number' ? payload.jobId : null,
    summaryJobStatus,
    summaryText,
    summaryStatus,
    summaryUpdatedAt: payload.summaryUpdatedAt ? String(payload.summaryUpdatedAt) : null,
    summaryProvider: payload.summaryProvider === 'glm' ? 'glm' : 'none',
    summaryError: payload.summaryError ? String(payload.summaryError) : null,
  }
}

const readSummaryApiPayload = async (
  response: Response,
): Promise<{ payload: Record<string, unknown>; rawText: string }> => {
  const contentType = response.headers.get('content-type')?.toLowerCase() || ''

  if (contentType.includes('application/json')) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    return { payload, rawText: '' }
  }

  const rawText = await response.text().catch(() => '')
  const trimmed = rawText.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      return { payload: parsed, rawText }
    } catch {
      // ignore malformed payload
    }
  }

  return { payload: {}, rawText }
}

const buildSummaryApiFailureMessage = (
  response: Response,
  payload: Record<string, unknown>,
  rawText: string,
  fallback: string,
): string => {
  const payloadMessage = typeof payload.message === 'string' ? payload.message.trim() : ''
  if (response.status === 404) {
    const lowerPayloadMessage = payloadMessage.toLowerCase()
    const lowerText = rawText.toLowerCase()
    if (
      lowerPayloadMessage === 'not found' ||
      lowerPayloadMessage.includes('cannot post /api/github/summaries/regenerate') ||
      lowerPayloadMessage.includes('cannot get /api/github/summaries/status') ||
      lowerText.includes('cannot post /api/github/summaries/regenerate') ||
      lowerText.includes('cannot get /api/github/summaries/status')
    ) {
      return '요약 API 경로를 찾지 못했습니다. 서버를 최신 버전으로 재기동해 주세요.'
    }

    if (payloadMessage) {
      return payloadMessage
    }

    return '요약 대상 GitHub 카드가 원격 대시보드에 없습니다. 카드를 먼저 저장/동기화해 주세요.'
  }

  if (payloadMessage) {
    return payloadMessage
  }

  if (response.status === 401) {
    return '요약 API 인증에 실패했습니다. VITE_POSTGRES_SYNC_API_TOKEN 또는 서버 ADMIN_API_TOKEN을 확인해 주세요.'
  }

  return fallback
}

export const regenerateGithubSummary = async (
  repoId: string,
  options: { force?: boolean } = {},
): Promise<GithubSummaryApiResult> => {
  const remoteBaseUrl = getRemoteBaseUrl()
  if (!remoteBaseUrl) {
    throw new Error('원격 DB API가 설정되지 않았습니다. VITE_POSTGRES_SYNC_API_BASE_URL을 확인해 주세요.')
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
  })

  if (remoteApiToken) {
    headers.set('x-admin-token', remoteApiToken)
  }

  let response: Response
  try {
    response = await fetch(`${remoteBaseUrl}/api/github/summaries/regenerate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        repoId: repoId.toLowerCase(),
        force: Boolean(options.force),
      }),
    })
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '요약 API 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'
        : '요약 API 연결에 실패했습니다. 서버 상태와 CORS 설정을 확인해 주세요.'
    throw new Error(message)
  }

  const { payload, rawText } = await readSummaryApiPayload(response)

  if (!response.ok || payload.ok !== true) {
    throw new Error(
      buildSummaryApiFailureMessage(response, payload, rawText, `GitHub 요약 생성 요청 실패 (${response.status})`),
    )
  }

  return resolveGithubSummaryApiResult(payload)
}

export const fetchGithubSummaryStatus = async (repoId: string): Promise<GithubSummaryApiResult> => {
  const remoteBaseUrl = getRemoteBaseUrl()
  if (!remoteBaseUrl) {
    throw new Error('원격 DB API가 설정되지 않았습니다. VITE_POSTGRES_SYNC_API_BASE_URL을 확인해 주세요.')
  }

  const response = await fetch(
    `${remoteBaseUrl}/api/github/summaries/status?repoId=${encodeURIComponent(repoId.toLowerCase())}`,
  )
  const { payload, rawText } = await readSummaryApiPayload(response)

  if (!response.ok || payload.ok !== true) {
    throw new Error(
      buildSummaryApiFailureMessage(response, payload, rawText, `GitHub 요약 상태 조회 실패 (${response.status})`),
    )
  }

  return resolveGithubSummaryApiResult(payload)
}

export const fetchRepoDetail = async (owner: string, repo: string): Promise<RepoDetailData> => {
  const [readmeResult, commitsResult, issuesResult] = await Promise.allSettled([
    fetchReadme(owner, repo),
    fetchJson<GitHubCommitResponse[]>(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=6`),
    fetchJson<GitHubIssueResponse[]>(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=all&sort=updated&per_page=6`,
    ),
  ])

  const failedErrors = [readmeResult, commitsResult, issuesResult]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
    .filter(isGitHubError)

  if (failedErrors.length === 3) {
    const rateLimitError = failedErrors.find((error) => error.status === 403)
    if (rateLimitError) {
      throw new GitHubApiError(
        'GitHub API 요청 제한에 도달했습니다. `VITE_GITHUB_TOKEN`을 설정하면 README/Activity를 안정적으로 볼 수 있습니다.',
        403,
      )
    }

    const timeoutError = failedErrors.find((error) => error.status === 408)
    if (timeoutError) {
      throw new GitHubApiError('상세 정보 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.', 408)
    }
  }

  const latestCommitSha =
    commitsResult.status === 'fulfilled' && commitsResult.value.length > 0 ? commitsResult.value[0].sha : null

  const commits = commitsResult.status === 'fulfilled' ? mapCommitActivity(commitsResult.value) : []
  const issues = issuesResult.status === 'fulfilled' ? mapIssueActivity(issuesResult.value) : []

  const recentActivityRaw = [...commits, ...issues]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8)

  const readme = readmeResult.status === 'fulfilled' ? readmeResult.value : null
  const readmePreviewText = readmePreview(readme)

  return {
    readmePreview: readmePreviewText,
    recentActivity: recentActivityRaw,
    latestCommitSha,
  }
}
