import { DEFAULT_MAIN_CATEGORY_ID } from '@constants'
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

type GitHubSearchRepoItemResponse = {
  full_name: string
  owner: { login: string }
  name: string
  description: string | null
  html_url: string
  language: string | null
  stargazers_count: number
  forks_count: number
  updated_at: string
  topics?: string[]
}

type GitHubSearchResponse = {
  total_count: number
  items: GitHubSearchRepoItemResponse[]
}

export type GitHubRepoSearchItem = {
  id: string
  owner: string
  repo: string
  fullName: string
  description: string
  htmlUrl: string
  language: string | null
  stars: number
  forks: number
  topics: string[]
  updatedAt: string
}

export type GitHubRepoSearchPage = {
  items: GitHubRepoSearchItem[]
  totalCount: number
  page: number
  perPage: number
  hasNextPage: boolean
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

  if (response.status === 422) {
    return payload.message
      ? `검색어가 유효하지 않습니다. ${payload.message}`
      : '검색어가 유효하지 않습니다. 2자 이상의 검색어를 입력해 주세요.'
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
  }
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

export const searchPublicRepos = async (
  query: string,
  page: number,
  perPage = 12,
): Promise<GitHubRepoSearchPage> => {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      perPage,
      hasNextPage: false,
    }
  }

  const safePage = Math.max(1, Math.floor(page))
  const safePerPage = Math.min(Math.max(Math.floor(perPage), 1), 100)
  const search = new URLSearchParams({
    q: `${normalizedQuery} in:name,description`,
    sort: 'stars',
    order: 'desc',
    page: String(safePage),
    per_page: String(safePerPage),
  })

  const payload = await fetchJson<GitHubSearchResponse>(`https://api.github.com/search/repositories?${search.toString()}`)

  const items = (payload.items ?? []).map((item) => ({
    id: item.full_name.toLowerCase(),
    owner: item.owner.login,
    repo: item.name,
    fullName: item.full_name,
    description: item.description ?? '',
    htmlUrl: item.html_url,
    language: item.language,
    stars: item.stargazers_count,
    forks: item.forks_count,
    topics: item.topics ?? [],
    updatedAt: item.updated_at,
  }))

  return {
    items,
    totalCount: Number.isFinite(payload.total_count) ? Math.max(0, payload.total_count) : 0,
    page: safePage,
    perPage: safePerPage,
    hasNextPage: safePage * safePerPage < (payload.total_count ?? 0),
  }
}
