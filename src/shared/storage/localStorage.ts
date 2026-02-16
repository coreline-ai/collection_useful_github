import {
  CARDS_STORAGE_KEY,
  CATEGORIES_STORAGE_KEY,
  DEFAULT_MAIN_CATEGORY_ID,
  NOTES_STORAGE_KEY,
  SELECTED_CATEGORY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  TOP_SECTION_STORAGE_KEY,
} from '../../constants'
import type { Category, CategoryId, GitHubRepoCard, NotesByRepo, ThemeMode, TopSection } from '../../types'

const canUseStorage = (): boolean => typeof window !== 'undefined' && Boolean(window.localStorage)

const safeParse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const loadCards = (): GitHubRepoCard[] => {
  if (!canUseStorage()) {
    return []
  }

  const rawCards = safeParse<Array<GitHubRepoCard & { categoryId?: string }>>(
    window.localStorage.getItem(CARDS_STORAGE_KEY),
    [],
  )

  return rawCards.map((card) => ({
    ...card,
    categoryId: card.categoryId ?? DEFAULT_MAIN_CATEGORY_ID,
  }))
}

export const loadNotes = (): NotesByRepo => {
  if (!canUseStorage()) {
    return {}
  }

  return safeParse<NotesByRepo>(window.localStorage.getItem(NOTES_STORAGE_KEY), {})
}

export const saveCards = (cards: GitHubRepoCard[]): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(cards))
}

export const saveNotes = (notes: NotesByRepo): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes))
}

export const loadCategories = (): Category[] => {
  if (!canUseStorage()) {
    return []
  }

  return safeParse<Category[]>(window.localStorage.getItem(CATEGORIES_STORAGE_KEY), [])
}

export const saveCategories = (categories: Category[]): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(categories))
}

export const loadSelectedCategoryId = (): CategoryId | null => {
  if (!canUseStorage()) {
    return null
  }

  const value = window.localStorage.getItem(SELECTED_CATEGORY_STORAGE_KEY)
  return value && value.trim() ? value : null
}

export const saveSelectedCategoryId = (categoryId: CategoryId): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(SELECTED_CATEGORY_STORAGE_KEY, categoryId)
}

export const loadThemeMode = (): ThemeMode | null => {
  if (!canUseStorage()) {
    return null
  }

  const value = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (value === 'light' || value === 'dark') {
    return value
  }

  return null
}

export const saveThemeMode = (mode: ThemeMode): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, mode)
}

export const loadTopSection = (): TopSection | null => {
  if (!canUseStorage()) {
    return null
  }

  const value = window.localStorage.getItem(TOP_SECTION_STORAGE_KEY)

  if (value === 'search' || value === 'github' || value === 'youtube' || value === 'bookmark') {
    return value
  }

  return null
}

export const saveTopSection = (section: TopSection): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(TOP_SECTION_STORAGE_KEY, section)
}
