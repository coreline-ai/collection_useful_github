import { beforeEach, describe, expect, it } from 'vitest'
import {
  CARDS_STORAGE_KEY,
  CATEGORIES_STORAGE_KEY,
  DEFAULT_MAIN_CATEGORY_ID,
  NOTES_STORAGE_KEY,
  SELECTED_CATEGORY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  TOP_SECTION_STORAGE_KEY,
} from '../constants'
import {
  loadCards,
  loadCategories,
  loadNotes,
  loadSelectedCategoryId,
  loadThemeMode,
  loadTopSection,
  saveCards,
  saveCategories,
  saveNotes,
  saveSelectedCategoryId,
  saveThemeMode,
  saveTopSection,
} from './localStorage'

describe('localStorage theme mode', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('saves and loads theme mode', () => {
    saveThemeMode('dark')
    expect(loadThemeMode()).toBe('dark')
  })

  it('returns null for invalid stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'invalid')
    expect(loadThemeMode()).toBeNull()
  })
})

describe('localStorage top section', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('saves and loads top section', () => {
    saveTopSection('search')
    expect(loadTopSection()).toBe('search')
  })

  it('returns null for invalid top section value', () => {
    window.localStorage.setItem(TOP_SECTION_STORAGE_KEY, 'invalid')
    expect(loadTopSection()).toBeNull()
  })
})

describe('localStorage dashboard data', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('migrates cards without categoryId to main category on load', () => {
    window.localStorage.setItem(
      CARDS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'owner/repo',
          owner: 'owner',
          repo: 'repo',
          fullName: 'owner/repo',
          description: '',
          summary: '',
          htmlUrl: 'https://github.com/owner/repo',
          homepage: null,
          language: null,
          stars: 0,
          forks: 0,
          watchers: 0,
          openIssues: 0,
          topics: [],
          license: null,
          defaultBranch: 'main',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    )

    const cards = loadCards()

    expect(cards).toHaveLength(1)
    expect(cards[0].categoryId).toBe(DEFAULT_MAIN_CATEGORY_ID)
  })

  it('saves and loads cards/notes/categories/selected category', () => {
    saveCards([
      {
        id: 'owner/repo',
        categoryId: 'main',
        owner: 'owner',
        repo: 'repo',
        fullName: 'owner/repo',
        description: '',
        summary: '',
        htmlUrl: 'https://github.com/owner/repo',
        homepage: null,
        language: null,
        stars: 0,
        forks: 0,
        watchers: 0,
        openIssues: 0,
        topics: [],
        license: null,
        defaultBranch: 'main',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    saveNotes({
      'owner/repo': [
        {
          id: 'note-1',
          repoId: 'owner/repo',
          content: 'memo',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    saveCategories([
      { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'frontend', name: '프론트엔드', isSystem: false, createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    saveSelectedCategoryId('frontend')

    expect(loadCards()).toHaveLength(1)
    expect(loadNotes()['owner/repo'][0].content).toBe('memo')
    expect(loadCategories()).toHaveLength(3)
    expect(loadSelectedCategoryId()).toBe('frontend')
  })

  it('returns null for empty selected category id', () => {
    window.localStorage.setItem(SELECTED_CATEGORY_STORAGE_KEY, '   ')
    expect(loadSelectedCategoryId()).toBeNull()
  })

  it('returns fallback values for broken json payloads', () => {
    window.localStorage.setItem(CARDS_STORAGE_KEY, '{broken')
    window.localStorage.setItem(NOTES_STORAGE_KEY, '{broken')
    window.localStorage.setItem(CATEGORIES_STORAGE_KEY, '{broken')

    expect(loadCards()).toEqual([])
    expect(loadNotes()).toEqual({})
    expect(loadCategories()).toEqual([])
  })
})
