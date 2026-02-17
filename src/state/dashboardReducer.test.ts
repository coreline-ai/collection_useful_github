import { describe, expect, it } from 'vitest'
import { DEFAULT_MAIN_CATEGORY_ID, DEFAULT_WAREHOUSE_CATEGORY_ID } from '../constants'
import type { Category, GitHubRepoCard, RepoNote } from '../types'
import { dashboardReducer, type DashboardState } from './dashboardReducer'

const baseCategories: Category[] = [
  {
    id: DEFAULT_MAIN_CATEGORY_ID,
    name: '메인',
    isSystem: true,
    createdAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: DEFAULT_WAREHOUSE_CATEGORY_ID,
    name: '창고',
    isSystem: true,
    createdAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'frontend',
    name: '프론트엔드',
    isSystem: false,
    createdAt: '2026-02-01T00:00:00.000Z',
  },
]

const createCard = (index: number, categoryId = DEFAULT_MAIN_CATEGORY_ID): GitHubRepoCard => ({
  id: `owner/repo-${index}`,
  categoryId,
  owner: 'owner',
  repo: `repo-${index}`,
  fullName: `owner/repo-${index}`,
  description: 'desc',
  summary: 'summary',
  htmlUrl: 'https://github.com/owner/repo',
  homepage: null,
  language: 'TypeScript',
  stars: 1,
  forks: 1,
  watchers: 1,
  openIssues: 1,
  topics: [],
  license: null,
  defaultBranch: 'main',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  addedAt: new Date().toISOString(),
  summaryStatus: 'ready',
  summaryProvider: 'none',
  summaryUpdatedAt: null,
  summaryError: null,
})

const createState = (cards: GitHubRepoCard[]): DashboardState => ({
  cards,
  notesByRepo: {},
  categories: baseCategories,
  selectedCategoryId: DEFAULT_MAIN_CATEGORY_ID,
  currentPage: 1,
  selectedRepoId: null,
})

describe('dashboardReducer', () => {
  it('keeps page value >= 1', () => {
    const cards = Array.from({ length: 13 }, (_, index) => createCard(index + 1))

    const nextState = dashboardReducer(createState(cards), {
      type: 'setPage',
      payload: { page: 0 },
    })

    expect(nextState.currentPage).toBe(1)
  })

  it('adds and prepends note for selected repo', () => {
    const state = createState([createCard(1)])

    const firstNote: RepoNote = {
      id: '1',
      repoId: 'owner/repo-1',
      content: 'first',
      createdAt: '2026-02-15T00:00:00.000Z',
    }

    const secondNote: RepoNote = {
      id: '2',
      repoId: 'owner/repo-1',
      content: 'second',
      createdAt: '2026-02-16T00:00:00.000Z',
    }

    const withFirst = dashboardReducer(state, { type: 'addNote', payload: firstNote })
    const withSecond = dashboardReducer(withFirst, { type: 'addNote', payload: secondNote })

    expect(withSecond.notesByRepo['owner/repo-1'].map((note) => note.id)).toEqual(['2', '1'])
  })

  it('removes note bucket and closes modal when deleting selected card', () => {
    const state: DashboardState = {
      cards: [createCard(1)],
      notesByRepo: {
        'owner/repo-1': [
          {
            id: 'n1',
            repoId: 'owner/repo-1',
            content: 'memo',
            createdAt: '2026-02-16T00:00:00.000Z',
          },
        ],
      },
      categories: baseCategories,
      selectedCategoryId: DEFAULT_MAIN_CATEGORY_ID,
      currentPage: 1,
      selectedRepoId: 'owner/repo-1',
    }

    const result = dashboardReducer(state, {
      type: 'removeCard',
      payload: { repoId: 'owner/repo-1' },
    })

    expect(result.selectedRepoId).toBeNull()
    expect(result.notesByRepo['owner/repo-1']).toBeUndefined()
  })

  it('moves card to target category and places it at top of that category list', () => {
    const state = createState([
      createCard(1, DEFAULT_MAIN_CATEGORY_ID),
      createCard(2, 'frontend'),
      createCard(3, 'frontend'),
      createCard(4, DEFAULT_MAIN_CATEGORY_ID),
    ])

    const result = dashboardReducer(state, {
      type: 'moveCardToCategory',
      payload: {
        repoId: 'owner/repo-4',
        targetCategoryId: 'frontend',
      },
    })

    const frontendCards = result.cards.filter((card) => card.categoryId === 'frontend')
    expect(frontendCards.map((card) => card.id)).toEqual(['owner/repo-4', 'owner/repo-2', 'owner/repo-3'])
  })

  it('deletes category and moves its cards to warehouse', () => {
    const state: DashboardState = {
      cards: [
        createCard(1, DEFAULT_MAIN_CATEGORY_ID),
        createCard(2, 'frontend'),
        createCard(3, DEFAULT_WAREHOUSE_CATEGORY_ID),
        createCard(4, 'frontend'),
      ],
      notesByRepo: {},
      categories: baseCategories,
      selectedCategoryId: 'frontend',
      currentPage: 2,
      selectedRepoId: null,
    }

    const result = dashboardReducer(state, {
      type: 'deleteCategory',
      payload: { categoryId: 'frontend' },
    })

    expect(result.categories.some((category) => category.id === 'frontend')).toBe(false)
    expect(result.selectedCategoryId).toBe(DEFAULT_MAIN_CATEGORY_ID)
    expect(result.currentPage).toBe(1)

    const warehouseCards = result.cards.filter((card) => card.categoryId === DEFAULT_WAREHOUSE_CATEGORY_ID)
    expect(warehouseCards.map((card) => card.id)).toEqual(['owner/repo-2', 'owner/repo-4', 'owner/repo-3'])
  })

  it('patches summary fields on a single card only', () => {
    const state = createState([createCard(1), createCard(2)])
    const result = dashboardReducer(state, {
      type: 'patchCardSummary',
      payload: {
        repoId: 'owner/repo-1',
        patch: {
          summary: '새 요약',
          summaryStatus: 'ready',
          summaryProvider: 'glm',
          summaryUpdatedAt: '2026-02-17T00:00:00.000Z',
          summaryError: null,
        },
      },
    })

    expect(result.cards[0].summary).toBe('새 요약')
    expect(result.cards[0].summaryProvider).toBe('glm')
    expect(result.cards[1].summary).toBe('summary')
    expect(result.cards[1].summaryProvider).toBe('none')
  })
})
