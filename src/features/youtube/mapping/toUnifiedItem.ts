import type { UnifiedItem } from '@shared/types'

export type YoutubeDraftItem = {
  nativeId: string
  title: string
  summary: string
  description: string
  url: string
  tags?: string[]
  author?: string | null
  views?: number
  likes?: number
  createdAt?: string
  updatedAt?: string
}

export const toYoutubeUnifiedItem = (item: YoutubeDraftItem): UnifiedItem => {
  const now = new Date().toISOString()

  return {
    id: `youtube:${item.nativeId}`,
    provider: 'youtube',
    type: 'video',
    nativeId: item.nativeId,
    title: item.title,
    summary: item.summary,
    description: item.description,
    url: item.url,
    tags: item.tags ?? [],
    author: item.author ?? null,
    language: null,
    metrics: {
      views: item.views,
      likes: item.likes,
    },
    status: 'active',
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
    savedAt: now,
    raw: {},
  }
}
