import { describe, expect, it } from 'vitest'
import { toBookmarkUnifiedItem } from './toUnifiedItem'

describe('toBookmarkUnifiedItem', () => {
  it('maps bookmark card to unified item fields', () => {
    const item = toBookmarkUnifiedItem(
      {
        id: 'https://example.com/post-1',
        categoryId: 'main',
        url: 'https://example.com/post-1',
        normalizedUrl: 'https://example.com/post-1',
        canonicalUrl: 'https://example.com/post-1',
        domain: 'example.com',
        title: 'Post title',
        excerpt: 'Post summary',
        summaryText: '',
        summaryStatus: 'idle',
        summaryProvider: 'none',
        summaryUpdatedAt: null,
        summaryError: null,
        thumbnailUrl: 'https://example.com/og.png',
        faviconUrl: 'https://example.com/favicon.ico',
        tags: ['news'],
        addedAt: '2026-02-16T08:30:00.000Z',
        updatedAt: '2026-02-16T08:30:00.000Z',
        metadataStatus: 'ok',
        linkStatus: 'unknown',
        lastCheckedAt: null,
        lastStatusCode: null,
        lastResolvedUrl: null,
      },
      3,
    )

    expect(item.id).toBe('bookmark:https://example.com/post-1')
    expect(item.provider).toBe('bookmark')
    expect(item.type).toBe('bookmark')
    expect(item.nativeId).toBe('https://example.com/post-1')
    expect(item.title).toBe('Post title')
    expect(item.summary).toBe('Post summary')
    expect(item.author).toBe('example.com')
    expect(item.status).toBe('active')
    expect(item.raw.sortIndex).toBe(3)
    expect(item.raw.metadataStatus).toBe('ok')
  })

  it('sets archived status when category is warehouse', () => {
    const item = toBookmarkUnifiedItem(
      {
        id: 'https://example.com/post-2',
        categoryId: 'warehouse',
        url: 'https://example.com/post-2',
        normalizedUrl: 'https://example.com/post-2',
        canonicalUrl: null,
        domain: 'example.com',
        title: 'Post title',
        excerpt: 'Post summary',
        summaryText: '',
        summaryStatus: 'idle',
        summaryProvider: 'none',
        summaryUpdatedAt: null,
        summaryError: null,
        thumbnailUrl: null,
        faviconUrl: null,
        tags: [],
        addedAt: '2026-02-16T08:30:00.000Z',
        updatedAt: '2026-02-16T08:30:00.000Z',
        metadataStatus: 'fallback',
        linkStatus: 'unknown',
        lastCheckedAt: null,
        lastStatusCode: null,
        lastResolvedUrl: null,
      },
      0,
    )

    expect(item.status).toBe('archived')
    expect(item.raw.metadataStatus).toBe('fallback')
  })
})
