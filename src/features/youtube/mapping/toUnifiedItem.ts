import type { UnifiedItem, YouTubeVideoCard } from '@shared/types'

const buildSummary = (description: string): string => {
  const normalized = description.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return '영상 설명이 없습니다.'
  }

  if (normalized.length <= 180) {
    return normalized
  }

  return `${normalized.slice(0, 177)}...`
}

export const toYoutubeUnifiedItem = (card: YouTubeVideoCard, sortIndex: number): UnifiedItem => {
  const normalizedVideoId = card.videoId || card.id
  const summaryText = typeof card.summaryText === 'string' ? card.summaryText.trim() : ''
  const resolvedSummary = summaryText || buildSummary(card.description)

  return {
    id: `youtube:${normalizedVideoId}`,
    provider: 'youtube',
    type: 'video',
    nativeId: normalizedVideoId,
    title: card.title,
    summary: resolvedSummary,
    description: card.description,
    url: card.videoUrl,
    tags: [],
    author: card.channelTitle,
    language: null,
    metrics: {
      views: card.viewCount,
      likes: card.likeCount ?? undefined,
    },
    status: card.categoryId === 'warehouse' ? 'archived' : 'active',
    createdAt: card.publishedAt,
    updatedAt: card.updatedAt,
    savedAt: card.addedAt,
    raw: {
      categoryId: card.categoryId,
      sortIndex,
      card: {
        ...card,
        id: card.id || normalizedVideoId,
        videoId: normalizedVideoId,
      },
    },
  }
}
