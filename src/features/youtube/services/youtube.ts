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
}

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
    addedAt: now,
    updatedAt: payload.video.updatedAt ?? payload.video.publishedAt ?? now,
  }
}
