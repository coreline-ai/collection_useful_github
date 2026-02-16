import type { BookmarkCard, UnifiedItem } from '@shared/types'

export const toBookmarkUnifiedItem = (card: BookmarkCard, sortIndex: number): UnifiedItem => {
  const normalizedUrl = card.normalizedUrl.trim()

  return {
    id: `bookmark:${normalizedUrl}`,
    provider: 'bookmark',
    type: 'bookmark',
    nativeId: normalizedUrl,
    title: card.title,
    summary: card.excerpt,
    description: card.excerpt,
    url: card.url,
    tags: card.tags,
    author: card.domain,
    language: null,
    metrics: {},
    status: card.categoryId === 'warehouse' ? 'archived' : 'active',
    createdAt: card.addedAt,
    updatedAt: card.updatedAt,
    savedAt: card.addedAt,
    raw: {
      card,
      categoryId: card.categoryId,
      sortIndex,
      metadataStatus: card.metadataStatus,
      linkStatus: card.linkStatus,
      lastCheckedAt: card.lastCheckedAt,
      lastStatusCode: card.lastStatusCode,
      lastResolvedUrl: card.lastResolvedUrl,
    },
  }
}
