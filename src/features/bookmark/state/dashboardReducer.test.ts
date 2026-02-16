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
  thumbnailUrl: null,
  faviconUrl: null,
  tags: [],
  addedAt: '2026-02-16T00:00:00.000Z',
  updatedAt: '2026-02-16T00:00:00.000Z',
  metadataStatus: 'ok',
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
