import {
  UNIFIED_INDEXES_STORAGE_KEY,
  UNIFIED_ITEMS_STORAGE_KEY,
  UNIFIED_META_STORAGE_KEY,
  UNIFIED_NOTES_STORAGE_KEY,
} from '@constants'
import type { UnifiedIndex, UnifiedMeta } from '@shared/types'
import { createEmptyUnifiedIndex, createInitialUnifiedMeta, type UnifiedItemsMap, type UnifiedNotesByItem } from '../schema'

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

export const loadUnifiedItemsMap = (): UnifiedItemsMap => {
  if (!canUseStorage()) {
    return {}
  }

  return safeParse<UnifiedItemsMap>(window.localStorage.getItem(UNIFIED_ITEMS_STORAGE_KEY), {})
}

export const saveUnifiedItemsMap = (items: UnifiedItemsMap): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(UNIFIED_ITEMS_STORAGE_KEY, JSON.stringify(items))
}

export const loadUnifiedIndexes = (): UnifiedIndex => {
  if (!canUseStorage()) {
    return createEmptyUnifiedIndex()
  }

  return safeParse<UnifiedIndex>(window.localStorage.getItem(UNIFIED_INDEXES_STORAGE_KEY), createEmptyUnifiedIndex())
}

export const saveUnifiedIndexes = (indexes: UnifiedIndex): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(UNIFIED_INDEXES_STORAGE_KEY, JSON.stringify(indexes))
}

export const loadUnifiedMeta = (): UnifiedMeta => {
  if (!canUseStorage()) {
    return createInitialUnifiedMeta()
  }

  const parsed = safeParse<UnifiedMeta>(window.localStorage.getItem(UNIFIED_META_STORAGE_KEY), createInitialUnifiedMeta())

  if (parsed.schemaVersion !== 1 || !parsed.migrated) {
    return createInitialUnifiedMeta()
  }

  return {
    schemaVersion: 1,
    migrated: {
      githubV1ToUnifiedV1: Boolean(parsed.migrated.githubV1ToUnifiedV1),
      migratedAt: parsed.migrated.migratedAt,
    },
  }
}

export const saveUnifiedMeta = (meta: UnifiedMeta): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(UNIFIED_META_STORAGE_KEY, JSON.stringify(meta))
}

export const loadUnifiedNotes = (): UnifiedNotesByItem => {
  if (!canUseStorage()) {
    return {}
  }

  return safeParse<UnifiedNotesByItem>(window.localStorage.getItem(UNIFIED_NOTES_STORAGE_KEY), {})
}

export const saveUnifiedNotes = (notes: UnifiedNotesByItem): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(UNIFIED_NOTES_STORAGE_KEY, JSON.stringify(notes))
}
