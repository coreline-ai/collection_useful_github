import { DETAIL_CACHE_STORAGE_KEY, DETAIL_CACHE_TTL_HOURS } from '../constants'
import type { RepoDetailCacheEntry, RepoDetailCacheMap } from '../types'

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

const maxAgeMs = DETAIL_CACHE_TTL_HOURS * 60 * 60 * 1000

const isExpired = (entry: RepoDetailCacheEntry): boolean => {
  const timestamp = new Date(entry.cachedAt).getTime()
  if (Number.isNaN(timestamp)) {
    return true
  }

  return Date.now() - timestamp > maxAgeMs
}

const persistMap = (cacheMap: RepoDetailCacheMap) => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(DETAIL_CACHE_STORAGE_KEY, JSON.stringify(cacheMap))
}

export const loadRepoDetailCacheMap = (): RepoDetailCacheMap => {
  if (!canUseStorage()) {
    return {}
  }

  const cacheMap = safeParse<RepoDetailCacheMap>(window.localStorage.getItem(DETAIL_CACHE_STORAGE_KEY), {})
  const validEntries = Object.entries(cacheMap).filter(([, entry]) => !isExpired(entry))
  const sanitized = Object.fromEntries(validEntries)

  if (validEntries.length !== Object.keys(cacheMap).length) {
    persistMap(sanitized)
  }

  return sanitized
}

export const getRepoDetailCache = (repoId: string): RepoDetailCacheEntry | null => {
  const cacheMap = loadRepoDetailCacheMap()
  return cacheMap[repoId] ?? null
}

export const upsertRepoDetailCache = (entry: RepoDetailCacheEntry): void => {
  const cacheMap = loadRepoDetailCacheMap()
  const nextMap: RepoDetailCacheMap = {
    ...cacheMap,
    [entry.repoId]: entry,
  }

  persistMap(nextMap)
}

export const removeRepoDetailCache = (repoId: string): void => {
  const cacheMap = loadRepoDetailCacheMap()

  if (!cacheMap[repoId]) {
    return
  }

  const nextMap = { ...cacheMap }
  delete nextMap[repoId]

  persistMap(nextMap)
}
