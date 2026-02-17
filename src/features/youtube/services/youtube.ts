import { DEFAULT_MAIN_CATEGORY_ID } from '@constants'
import type { YouTubeVideoCard } from '@shared/types'
import { getRemoteBaseUrl } from '@core/data/adapters/remoteDb'

type YouTubeVideoResponse = {
  videoId: string
  title: string
  channelTitle: string
  description: string
  thumbnailUrl: string
  publishedAt: string
  viewCount: number
  likeCount: number | null
  url: string
  updatedAt?: string
  summaryText?: string
  summaryStatus?: 'idle' | 'queued' | 'ready' | 'failed'
  summaryUpdatedAt?: string | null
  summaryProvider?: 'glm' | 'none'
  summaryError?: string | null
  notebookSourceStatus?: 'disabled' | 'queued' | 'linked' | 'failed'
  notebookSourceId?: string | null
  notebookId?: string | null
}

type YouTubeSummarizeResponse = {
  ok: boolean
  jobId?: number | null
  summaryJobStatus?: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'dead'
  summaryText?: string
  summaryStatus?: 'idle' | 'queued' | 'ready' | 'failed'
  summaryUpdatedAt?: string | null
  summaryProvider?: 'glm' | 'none'
  summaryError?: string | null
  notebookSourceStatus?: 'disabled' | 'queued' | 'linked' | 'failed'
  notebookSourceId?: string | null
  notebookId?: string | null
  message?: string
}

type YouTubeSummaryStateFields = Pick<
  YouTubeVideoCard,
  | 'summaryText'
  | 'summaryStatus'
  | 'summaryUpdatedAt'
  | 'summaryProvider'
  | 'summaryError'
  | 'notebookSourceStatus'
  | 'notebookSourceId'
  | 'notebookId'
>

type YouTubeSummaryApiResult = {
  jobId: number | null
  summaryJobStatus: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'dead'
} & YouTubeSummaryStateFields

export const parseYouTubeVideoUrl = (input: string): { videoId: string } | null => {
  const raw = input.trim()
  if (!raw) {
    return null
  }

  let candidate = raw
  if (/^(youtube\.com|www\.youtube\.com|m\.youtube\.com|youtu\.be)\//i.test(candidate)) {
    candidate = `https://${candidate}`
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')
  let videoId = ''

  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] ?? ''
  } else if (host === 'youtube.com') {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v') ?? ''
    } else if (url.pathname.startsWith('/shorts/')) {
      videoId = url.pathname.split('/').filter(Boolean)[1] ?? ''
    }
  }

  videoId = videoId.trim()

  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
    return null
  }

  return { videoId }
}

export const buildYouTubeSummary = (description: string): string => {
  const normalized = description.replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return '영상 설명이 없습니다.'
  }

  if (normalized.length <= 180) {
    return normalized
  }

  return `${normalized.slice(0, 177)}...`
}

const parseErrorMessage = async (response: Response): Promise<string> => {
  let payload: { message?: string } = {}

  try {
    payload = (await response.json()) as { message?: string }
  } catch {
    payload = {}
  }

  if (response.status === 404) {
    return '영상을 찾을 수 없습니다. URL을 확인해 주세요.'
  }

  if (response.status === 403) {
    return 'YouTube API 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.'
  }

  if (response.status === 503) {
    return payload.message || 'YouTube API 키가 설정되지 않았습니다.'
  }

  return payload.message ? `YouTube API 오류: ${payload.message}` : `YouTube API 요청 실패 (${response.status})`
}

const toSummaryStatus = (
  value: unknown,
  summaryText: string,
): YouTubeVideoCard['summaryStatus'] => {
  if (value === 'queued' || value === 'ready' || value === 'failed') {
    return value
  }

  return summaryText ? 'ready' : 'idle'
}

const toSummaryProvider = (value: unknown): YouTubeVideoCard['summaryProvider'] => {
  return value === 'glm' ? 'glm' : 'none'
}

const toNotebookSourceStatus = (value: unknown): YouTubeVideoCard['notebookSourceStatus'] => {
  if (value === 'queued' || value === 'linked' || value === 'failed') {
    return value
  }

  return 'disabled'
}

export const resolveYouTubeSummaryFields = (
  source: Partial<YouTubeVideoCard> & Record<string, unknown>,
): YouTubeSummaryStateFields => {
  const summaryText = typeof source.summaryText === 'string' ? source.summaryText : ''

  return {
    summaryText,
    summaryStatus: toSummaryStatus(source.summaryStatus, summaryText.trim()),
    summaryUpdatedAt: source.summaryUpdatedAt ? String(source.summaryUpdatedAt) : null,
    summaryProvider: toSummaryProvider(source.summaryProvider),
    summaryError: source.summaryError ? String(source.summaryError) : null,
    notebookSourceStatus: toNotebookSourceStatus(source.notebookSourceStatus),
    notebookSourceId: source.notebookSourceId ? String(source.notebookSourceId) : null,
    notebookId: source.notebookId ? String(source.notebookId) : null,
  }
}

export const fetchYouTubeVideo = async (videoId: string): Promise<YouTubeVideoCard> => {
  const remoteBaseUrl = getRemoteBaseUrl()

  if (!remoteBaseUrl) {
    throw new Error('원격 DB API가 설정되지 않았습니다. VITE_POSTGRES_SYNC_API_BASE_URL을 확인해 주세요.')
  }

  const response = await fetch(`${remoteBaseUrl}/api/youtube/videos/${encodeURIComponent(videoId)}`)

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  const payload = (await response.json()) as { ok: boolean; video?: YouTubeVideoResponse; message?: string }

  if (!payload.ok || !payload.video) {
    throw new Error(payload.message || 'YouTube 영상 정보를 불러오지 못했습니다.')
  }

  const now = new Date().toISOString()
  const summaryFields = resolveYouTubeSummaryFields(payload.video)
  return {
    id: payload.video.videoId,
    videoId: payload.video.videoId,
    categoryId: DEFAULT_MAIN_CATEGORY_ID,
    title: payload.video.title,
    channelTitle: payload.video.channelTitle,
    description: payload.video.description,
    thumbnailUrl: payload.video.thumbnailUrl,
    videoUrl: payload.video.url,
    publishedAt: payload.video.publishedAt,
    viewCount: Number(payload.video.viewCount || 0),
    likeCount:
      typeof payload.video.likeCount === 'number' && Number.isFinite(payload.video.likeCount)
        ? payload.video.likeCount
        : null,
    ...summaryFields,
    addedAt: now,
    updatedAt: payload.video.updatedAt ?? payload.video.publishedAt ?? now,
  }
}

export const summarizeYouTubeVideo = async (
  videoId: string,
  options: { force?: boolean } = {},
): Promise<YouTubeSummaryApiResult> => {
  const remoteBaseUrl = getRemoteBaseUrl()

  if (!remoteBaseUrl) {
    throw new Error('원격 DB API가 설정되지 않았습니다. VITE_POSTGRES_SYNC_API_BASE_URL을 확인해 주세요.')
  }

  let response: Response
  try {
    response = await fetch(`${remoteBaseUrl}/api/youtube/videos/${encodeURIComponent(videoId)}/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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

  const payload = (await response.json().catch(() => ({}))) as YouTubeSummarizeResponse

  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || `YouTube 요약 생성 요청 실패 (${response.status})`)
  }

  return {
    jobId: typeof payload.jobId === 'number' ? payload.jobId : null,
    summaryJobStatus:
      payload.summaryJobStatus === 'queued' ||
      payload.summaryJobStatus === 'running' ||
      payload.summaryJobStatus === 'succeeded' ||
      payload.summaryJobStatus === 'failed' ||
      payload.summaryJobStatus === 'dead'
        ? payload.summaryJobStatus
        : 'idle',
    ...resolveYouTubeSummaryFields(payload),
  }
}

export const fetchYouTubeSummaryStatus = async (
  videoId: string,
): Promise<YouTubeSummaryApiResult> => {
  const remoteBaseUrl = getRemoteBaseUrl()

  if (!remoteBaseUrl) {
    throw new Error('원격 DB API가 설정되지 않았습니다. VITE_POSTGRES_SYNC_API_BASE_URL을 확인해 주세요.')
  }

  const response = await fetch(
    `${remoteBaseUrl}/api/youtube/summaries/${encodeURIComponent(videoId)}/status`,
  )
  const payload = (await response.json().catch(() => ({}))) as YouTubeSummarizeResponse

  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || `YouTube 요약 상태 조회 실패 (${response.status})`)
  }

  return {
    jobId: typeof payload.jobId === 'number' ? payload.jobId : null,
    summaryJobStatus:
      payload.summaryJobStatus === 'queued' ||
      payload.summaryJobStatus === 'running' ||
      payload.summaryJobStatus === 'succeeded' ||
      payload.summaryJobStatus === 'failed' ||
      payload.summaryJobStatus === 'dead'
        ? payload.summaryJobStatus
        : 'idle',
    ...resolveYouTubeSummaryFields(payload),
  }
}
