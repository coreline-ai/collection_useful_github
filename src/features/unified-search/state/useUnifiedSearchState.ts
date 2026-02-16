import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  exportUnifiedBackup,
  importUnifiedBackup,
  isRemoteSnapshotEnabled,
  searchUnifiedItems,
} from '@core/data/adapters/remoteDb'
import {
  UNIFIED_RECENT_QUERIES_MAX_ENTRIES,
  UNIFIED_RECENT_QUERIES_STORAGE_KEY,
  UNIFIED_SEARCH_CACHE_MAX_ENTRIES,
  UNIFIED_SEARCH_CACHE_TTL_MS,
} from '@constants'
import type { ProviderType, UnifiedItem, UnifiedItemType } from '@shared/types'

type SearchProviderFilter = ProviderType | 'all'
type SearchTypeFilter = UnifiedItemType | 'all'

type SearchCacheEntry = {
  items: UnifiedItem[]
  expiresAt: number
}

export type RecentUnifiedSearchQuery = {
  q: string
  provider: SearchProviderFilter
  type: SearchTypeFilter
  searchedAt: string
}

export type UnifiedSearchState = {
  remoteEnabled: boolean
  searchInput: string
  searchProvider: SearchProviderFilter
  searchType: SearchTypeFilter
  searchLoading: boolean
  searchResults: UnifiedItem[]
  searchMessage: string | null
  recentQueries: RecentUnifiedSearchQuery[]
  backupLoading: boolean
  backupMessage: string | null
  importInputRef: RefObject<HTMLInputElement | null>
  setSearchInput: (value: string) => void
  setSearchProvider: (value: SearchProviderFilter) => void
  setSearchType: (value: SearchTypeFilter) => void
  handleSearch: () => Promise<void>
  handleSelectRecentQuery: (query: RecentUnifiedSearchQuery) => Promise<void>
  handleClearRecentQueries: () => void
  handleExportBackup: () => Promise<void>
  handleImportBackupFile: (file: File | null) => Promise<void>
}

const canUseStorage = (): boolean => typeof window !== 'undefined' && Boolean(window.localStorage)

const normalizeQuery = (value: string): string => value.trim().toLocaleLowerCase('ko-KR')

const toCacheKey = (params: { q: string; provider: SearchProviderFilter; type: SearchTypeFilter }): string => {
  return [
    normalizeQuery(params.q),
    params.provider,
    params.type,
    40,
    'relevance',
    'true',
    'true',
    '0',
  ].join('|')
}

const loadRecentQueries = (): RecentUnifiedSearchQuery[] => {
  if (!canUseStorage()) {
    return []
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(UNIFIED_RECENT_QUERIES_STORAGE_KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }

        const q = typeof entry.q === 'string' ? entry.q.trim() : ''
        const provider = entry.provider === 'github' || entry.provider === 'youtube' || entry.provider === 'bookmark'
          ? entry.provider
          : 'all'
        const type = entry.type === 'repository' || entry.type === 'video' || entry.type === 'bookmark' ? entry.type : 'all'
        const searchedAt =
          typeof entry.searchedAt === 'string' && entry.searchedAt.trim()
            ? entry.searchedAt
            : new Date().toISOString()

        if (!q) {
          return null
        }

        return {
          q,
          provider,
          type,
          searchedAt,
        } satisfies RecentUnifiedSearchQuery
      })
      .filter((value): value is RecentUnifiedSearchQuery => value !== null)
      .slice(0, UNIFIED_RECENT_QUERIES_MAX_ENTRIES)
  } catch {
    return []
  }
}

const saveRecentQueries = (recentQueries: RecentUnifiedSearchQuery[]): void => {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(
    UNIFIED_RECENT_QUERIES_STORAGE_KEY,
    JSON.stringify(recentQueries.slice(0, UNIFIED_RECENT_QUERIES_MAX_ENTRIES)),
  )
}

const upsertRecentQuery = (
  recentQueries: RecentUnifiedSearchQuery[],
  target: RecentUnifiedSearchQuery,
): RecentUnifiedSearchQuery[] => {
  const deduped = recentQueries.filter(
    (entry) =>
      normalizeQuery(entry.q) !== normalizeQuery(target.q) ||
      entry.provider !== target.provider ||
      entry.type !== target.type,
  )

  return [target, ...deduped].slice(0, UNIFIED_RECENT_QUERIES_MAX_ENTRIES)
}

export const useUnifiedSearchState = (): UnifiedSearchState => {
  const remoteEnabled = isRemoteSnapshotEnabled()
  const [searchInput, setSearchInput] = useState('')
  const [searchProvider, setSearchProvider] = useState<SearchProviderFilter>('all')
  const [searchType, setSearchType] = useState<SearchTypeFilter>('all')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<UnifiedItem[]>([])
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  const [recentQueries, setRecentQueries] = useState<RecentUnifiedSearchQuery[]>(() => loadRecentQueries())
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const searchCacheRef = useRef<Map<string, SearchCacheEntry>>(new Map())

  const readCache = (key: string): UnifiedItem[] | null => {
    const entry = searchCacheRef.current.get(key)

    if (!entry) {
      return null
    }

    if (entry.expiresAt <= Date.now()) {
      searchCacheRef.current.delete(key)
      return null
    }

    searchCacheRef.current.delete(key)
    searchCacheRef.current.set(key, entry)
    return entry.items
  }

  const writeCache = (key: string, items: UnifiedItem[]) => {
    const cache = searchCacheRef.current

    if (cache.has(key)) {
      cache.delete(key)
    }

    cache.set(key, {
      items,
      expiresAt: Date.now() + UNIFIED_SEARCH_CACHE_TTL_MS,
    })

    while (cache.size > UNIFIED_SEARCH_CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value
      if (!oldestKey) {
        break
      }
      cache.delete(oldestKey)
    }
  }

  const runSearch = async (query: string, provider: SearchProviderFilter, type: SearchTypeFilter): Promise<void> => {
    const trimmedQuery = query.trim()

    if (!trimmedQuery) {
      setSearchResults([])
      setSearchMessage('검색어를 입력해 주세요.')
      return
    }

    if (!remoteEnabled) {
      setSearchResults([])
      setSearchMessage('통합 검색은 원격 DB 연결 시 활성화됩니다.')
      return
    }

    const cacheKey = toCacheKey({
      q: trimmedQuery,
      provider,
      type,
    })
    const cachedItems = readCache(cacheKey)

    if (cachedItems) {
      setSearchResults(cachedItems)
      setSearchMessage(cachedItems.length > 0 ? null : '검색 결과가 없습니다.')
      return
    }

    setSearchLoading(true)
    setSearchMessage(null)

    try {
      const items = await searchUnifiedItems({
        query: trimmedQuery,
        provider,
        type,
        limit: 40,
        mode: 'relevance',
        fuzzy: true,
        prefix: true,
        minScore: 0,
      })
      writeCache(cacheKey, items)
      setSearchResults(items)
      setSearchMessage(items.length > 0 ? null : '검색 결과가 없습니다.')

      const nextRecent = upsertRecentQuery(recentQueries, {
        q: trimmedQuery,
        provider,
        type,
        searchedAt: new Date().toISOString(),
      })
      setRecentQueries(nextRecent)
      saveRecentQueries(nextRecent)
    } catch (error) {
      setSearchResults([])
      setSearchMessage(error instanceof Error ? error.message : '통합 검색에 실패했습니다.')
    } finally {
      setSearchLoading(false)
    }
  }

  const handleSearch = async () => {
    await runSearch(searchInput, searchProvider, searchType)
  }

  const handleSelectRecentQuery = async (query: RecentUnifiedSearchQuery) => {
    setSearchInput(query.q)
    setSearchProvider(query.provider)
    setSearchType(query.type)
    await runSearch(query.q, query.provider, query.type)
  }

  const handleClearRecentQueries = () => {
    setRecentQueries([])
    saveRecentQueries([])
  }

  const handleExportBackup = async () => {
    if (!remoteEnabled) {
      setBackupMessage('원격 DB가 연결되지 않아 백업을 내보낼 수 없습니다.')
      return
    }

    setBackupLoading(true)
    setBackupMessage(null)

    try {
      const payload = await exportUnifiedBackup()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `unified-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      anchor.click()
      window.URL.revokeObjectURL(url)
      setBackupMessage('백업 파일을 다운로드했습니다.')
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : '백업 내보내기에 실패했습니다.')
    } finally {
      setBackupLoading(false)
    }
  }

  const handleImportBackupFile = async (file: File | null) => {
    if (!file) {
      return
    }

    if (!remoteEnabled) {
      setBackupMessage('원격 DB가 연결되지 않아 복원을 실행할 수 없습니다.')
      return
    }

    setBackupLoading(true)
    setBackupMessage(null)

    try {
      const text = await file.text()
      const payload = JSON.parse(text) as Parameters<typeof importUnifiedBackup>[0]
      await importUnifiedBackup(payload)
      searchCacheRef.current.clear()
      setBackupMessage('백업 복원이 완료되었습니다. 화면을 새로고침합니다.')
      try {
        window.location.reload()
      } catch {
        // jsdom 등 reload를 구현하지 않는 환경을 위한 안전 처리
      }
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : '백업 복원에 실패했습니다.')
    } finally {
      setBackupLoading(false)
      if (importInputRef.current) {
        importInputRef.current.value = ''
      }
    }
  }

  return {
    remoteEnabled,
    searchInput,
    searchProvider,
    searchType,
    searchLoading,
    searchResults,
    searchMessage,
    recentQueries,
    backupLoading,
    backupMessage,
    importInputRef,
    setSearchInput,
    setSearchProvider,
    setSearchType,
    handleSearch,
    handleSelectRecentQuery,
    handleClearRecentQueries,
    handleExportBackup,
    handleImportBackupFile,
  }
}
