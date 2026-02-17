import { beforeEach, describe, expect, it } from 'vitest'
import { dashboardReducer, initialState } from './dashboardReducer'
import type { BookmarkCard } from '@shared/types'

const baseCard = (overrides: Partial<BookmarkCard> = {}): BookmarkCard => ({
  id: 'https://example.com/a',
  categoryId: 'main',
  url: 'https://example.com/a',
  normalizedUrl: 'https://example.com/a',
  canonicalUrl: null,
  domain: 'example.com',
  title: 'Example',
  excerpt: 'Excerpt',
  summaryText: '',
  summaryStatus: 'idle',
  summaryProvider: 'none',
  summaryUpdatedAt: null,
  summaryError: null,
  thumbnailUrl: null,
  faviconUrl: null,
  tags: [],
  addedAt: '2026-02-16T00:00:00.000Z',
  updatedAt: '2026-02-16T00:00:00.000Z',
  metadataStatus: 'ok',
  linkStatus: 'unknown',
  lastCheckedAt: null,
  lastStatusCode: null,
  lastResolvedUrl: null,
  ...overrides,
})

describe('bookmark dashboardReducer', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('adds card and keeps main as selected', () => {
    const state = initialState()
    const next = dashboardReducer(state, { type: 'addCard', payload: baseCard() })

    expect(next.cards).toHaveLength(1)
    expect(next.cards[0].normalizedUrl).toBe('https://example.com/a')
    expect(next.selectedCategoryId).toBe('main')
  })

  it('ignores duplicate normalizedUrl on add', () => {
    const state = initialState()
    const first = dashboardReducer(state, { type: 'addCard', payload: baseCard() })
    const duplicate = dashboardReducer(first, {
      type: 'addCard',
      payload: baseCard({ title: 'Duplicate title' }),
    })

    expect(duplicate.cards).toHaveLength(1)
    expect(duplicate.cards[0].title).toBe('Example')
  })

  it('moves card to target category', () => {
    let state = initialState()
    state = dashboardReducer(state, { type: 'addCard', payload: baseCard() })
    state = dashboardReducer(state, {
      type: 'createCategory',
      payload: {
        category: {
          id: 'bookmark_category_x',
          name: '읽기',
          isSystem: false,
          createdAt: '2026-02-16T00:00:00.000Z',
        },
      },
    })

    const next = dashboardReducer(state, {
      type: 'moveCardToCategory',
      payload: {
        normalizedUrl: 'https://example.com/a',
        targetCategoryId: 'bookmark_category_x',
      },
    })

    expect(next.cards[0].categoryId).toBe('bookmark_category_x')
  })

  it('updates card link status', () => {
    let state = initialState()
    state = dashboardReducer(state, { type: 'addCard', payload: baseCard() })

    const next = dashboardReducer(state, {
      type: 'updateLinkStatus',
      payload: {
        normalizedUrl: 'https://example.com/a',
        linkStatus: 'redirected',
        lastCheckedAt: '2026-02-16T12:00:00.000Z',
        lastStatusCode: 301,
        lastResolvedUrl: 'https://example.com/a?ref=canonical',
      },
    })

    expect(next.cards[0].linkStatus).toBe('redirected')
    expect(next.cards[0].lastStatusCode).toBe(301)
    expect(next.cards[0].lastResolvedUrl).toBe('https://example.com/a?ref=canonical')
  })

  it('patches bookmark summary fields', () => {
    let state = initialState()
    state = dashboardReducer(state, { type: 'addCard', payload: baseCard() })

    const next = dashboardReducer(state, {
      type: 'patchCardSummary',
      payload: {
        normalizedUrl: 'https://example.com/a',
        patch: {
          summaryText: '요약 결과',
          summaryStatus: 'ready',
          summaryProvider: 'glm',
          summaryUpdatedAt: '2026-02-17T10:00:00.000Z',
          summaryError: null,
        },
      },
    })

    expect(next.cards[0].summaryText).toBe('요약 결과')
    expect(next.cards[0].summaryStatus).toBe('ready')
    expect(next.cards[0].summaryProvider).toBe('glm')
  })

  it('deletes custom category and moves its cards to warehouse', () => {
    let state = initialState()
    state = dashboardReducer(state, {
      type: 'createCategory',
      payload: {
        category: {
          id: 'bookmark_category_x',
          name: '읽기',
          isSystem: false,
          createdAt: '2026-02-16T00:00:00.000Z',
        },
      },
    })
    state = dashboardReducer(state, {
      type: 'addCard',
      payload: baseCard({ categoryId: 'bookmark_category_x' }),
    })

    const next = dashboardReducer(state, {
      type: 'deleteCategory',
      payload: { categoryId: 'bookmark_category_x' },
    })

    expect(next.categories.some((category) => category.id === 'bookmark_category_x')).toBe(false)
    expect(next.cards[0].categoryId).toBe('warehouse')
  })
})
