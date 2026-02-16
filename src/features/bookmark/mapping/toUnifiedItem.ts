import type { UnifiedItem } from '@shared/types'

export type BookmarkDraftItem = {
  nativeId: string
  title: string
  summary: string
  description: string
  url: string
  tags?: string[]
  author?: string | null
  createdAt?: string
  updatedAt?: string
}

export const toBookmarkUnifiedItem = (item: BookmarkDraftItem): UnifiedItem => {
  const now = new Date().toISOString()

  return {
    id: `bookmark:${item.nativeId}`,
    provider: 'bookmark',
    type: 'bookmark',
    nativeId: item.nativeId,
    title: item.title,
    summary: item.summary,
    description: item.description,
    url: item.url,
    tags: item.tags ?? [],
    author: item.author ?? null,
    language: null,
    metrics: {},
    status: 'active',
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
    savedAt: now,
    raw: {},
  }
}
