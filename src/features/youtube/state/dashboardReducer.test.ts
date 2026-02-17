import { beforeEach, describe, expect, it } from 'vitest'
import { dashboardReducer, initialState } from './dashboardReducer'

describe('youtube dashboardReducer', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('initializes with system categories', () => {
    const state = initialState()
    expect(state.categories.map((category) => category.id)).toEqual(['main', 'warehouse'])
    expect(state.selectedCategoryId).toBe('main')
  })

  it('adds card and moves to another category', () => {
    const state = initialState()

    const withCategory = dashboardReducer(state, {
      type: 'createCategory',
      payload: {
        category: {
          id: 'music',
          name: 'Music',
          isSystem: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })

    const withCard = dashboardReducer(withCategory, {
      type: 'addCard',
      payload: {
        id: 'dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
        categoryId: 'main',
        title: 'Video',
        channelTitle: 'Channel',
        description: 'Desc',
        thumbnailUrl: 'https://img',
        videoUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        publishedAt: '2026-01-01T00:00:00.000Z',
        viewCount: 1,
        likeCount: null,
        summaryText: '',
        summaryStatus: 'idle',
        summaryUpdatedAt: null,
        summaryProvider: 'none',
        summaryError: null,
        notebookSourceStatus: 'disabled',
        notebookSourceId: null,
        notebookId: null,
        addedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    const moved = dashboardReducer(withCard, {
      type: 'moveCardToCategory',
      payload: { videoId: 'dQw4w9WgXcQ', targetCategoryId: 'music' },
    })

    expect(moved.cards[0].categoryId).toBe('music')
  })

  it('moves cards to warehouse when category is deleted', () => {
    const hydrated = dashboardReducer(initialState(), {
      type: 'hydrateDashboard',
      payload: {
        cards: [
          {
            id: 'dQw4w9WgXcQ',
            videoId: 'dQw4w9WgXcQ',
            categoryId: 'music',
            title: 'Video',
            channelTitle: 'Channel',
            description: 'Desc',
            thumbnailUrl: 'https://img',
            videoUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
            publishedAt: '2026-01-01T00:00:00.000Z',
            viewCount: 1,
            likeCount: null,
            summaryText: '',
            summaryStatus: 'idle',
            summaryUpdatedAt: null,
            summaryProvider: 'none',
            summaryError: null,
            notebookSourceStatus: 'disabled',
            notebookSourceId: null,
            notebookId: null,
            addedAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        categories: [
          { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'music', name: 'Music', isSystem: false, createdAt: '2026-01-01T00:00:00.000Z' },
        ],
        selectedCategoryId: 'music',
      },
    })

    const next = dashboardReducer(hydrated, {
      type: 'deleteCategory',
      payload: { categoryId: 'music' },
    })

    expect(next.cards[0].categoryId).toBe('warehouse')
    expect(next.selectedCategoryId).toBe('main')
  })

  it('patches card summary fields', () => {
    const hydrated = dashboardReducer(initialState(), {
      type: 'hydrateDashboard',
      payload: {
        cards: [
          {
            id: 'dQw4w9WgXcQ',
            videoId: 'dQw4w9WgXcQ',
            categoryId: 'main',
            title: 'Video',
            channelTitle: 'Channel',
            description: 'Desc',
            thumbnailUrl: 'https://img',
            videoUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
            publishedAt: '2026-01-01T00:00:00.000Z',
            viewCount: 1,
            likeCount: null,
            summaryText: '',
            summaryStatus: 'idle',
            summaryUpdatedAt: null,
            summaryProvider: 'none',
            summaryError: null,
            notebookSourceStatus: 'disabled',
            notebookSourceId: null,
            notebookId: null,
            addedAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        categories: [
          { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
        ],
        selectedCategoryId: 'main',
      },
    })

    const next = dashboardReducer(hydrated, {
      type: 'patchCard',
      payload: {
        videoId: 'dQw4w9WgXcQ',
        patch: {
          summaryText: '요약 텍스트',
          summaryStatus: 'ready',
          summaryProvider: 'glm',
          summaryUpdatedAt: '2026-01-02T00:00:00.000Z',
          summaryError: null,
        },
      },
    })

    expect(next.cards[0].summaryStatus).toBe('ready')
    expect(next.cards[0].summaryText).toBe('요약 텍스트')
    expect(next.cards[0].summaryProvider).toBe('glm')
  })
})
