import type { BookmarkCard, UnifiedItem } from '@shared/types'

export const toBookmarkUnifiedItem = (card: BookmarkCard, sortIndex: number): UnifiedItem => {
  const normalizedUrl = card.normalizedUrl.trim()
  const summary = card.summaryText.trim() || card.excerpt

  return {
    id: `bookmark:${normalizedUrl}`,
    provider: 'bookmark',
    type: 'bookmark',
    nativeId: normalizedUrl,
    title: card.title,
    summary,
    description: summary,
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
      summaryText: card.summaryText,
      summaryStatus: card.summaryStatus,
      summaryProvider: card.summaryProvider,
      summaryUpdatedAt: card.summaryUpdatedAt,
      summaryError: card.summaryError,
      linkStatus: card.linkStatus,
      lastCheckedAt: card.lastCheckedAt,
      lastStatusCode: card.lastStatusCode,
      lastResolvedUrl: card.lastResolvedUrl,
    },
  }
}
