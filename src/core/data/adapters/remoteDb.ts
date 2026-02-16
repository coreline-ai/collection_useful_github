import type {
  Category,
  CategoryId,
  GitHubRepoCard,
  GitHubDashboardSnapshot,
  ProviderType,
  UnifiedItem,
  UnifiedItemType,
} from '@shared/types'
import { DEFAULT_MAIN_CATEGORY_ID, DEFAULT_WAREHOUSE_CATEGORY_ID } from '@constants'
import { loadCategories, loadSelectedCategoryId } from '@shared/storage/localStorage'

export type UnifiedSearchParams = {
  query: string
  provider?: ProviderType | 'all'
  type?: UnifiedItemType | 'all'
  limit?: number
  mode?: 'relevance' | 'legacy'
  fuzzy?: boolean
  prefix?: boolean
  minScore?: number
}

export type UnifiedBackupPayload = {
  version: 1
  exportedAt: string
  data: {
    items: UnifiedItem[]
    notes: Array<{ id: string; provider: ProviderType; itemId: string; content: string; createdAt: string }>
    meta: Record<string, unknown>
  }
}

type ApiResponse<T> = {
  ok: boolean
  message?: string
} & T

type ProviderNotesPayload = ApiResponse<{
  notes: Array<{ id: string; itemId: string; content: string; createdAt: string }>
}>

const getRemoteBaseUrl = (): string | null => {
  const value = (import.meta.env.VITE_POSTGRES_SYNC_API_BASE_URL as string | undefined)?.trim()

  if (!value) {
    return null
  }

  return value.replace(/\/+$/, '')
}

export const isRemoteSnapshotEnabled = (): boolean => Boolean(getRemoteBaseUrl())

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const requestWithRetry = async (path: string, init?: RequestInit, retries = 2): Promise<Response> => {
  const baseUrl = getRemoteBaseUrl()

  if (!baseUrl) {
    throw new Error('원격 DB API가 설정되지 않았습니다.')
  }

  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init)

      if (response.status >= 500 && attempt < retries) {
        await wait(200 * (attempt + 1))
        continue
      }

      return response
    } catch (error) {
      lastError = error

      if (attempt < retries) {
        await wait(200 * (attempt + 1))
        continue
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('원격 API 요청에 실패했습니다.')
}

const parseErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = (await response.json()) as { message?: string }
    return payload.message || fallback
  } catch {
    return fallback
  }
}

const toIso = (value: unknown): string => {
  if (typeof value === 'string' || value instanceof Date) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
    }
  }

  return new Date().toISOString()
}

const ensureSystemCategories = (rawCategories: Category[]): Category[] => {
  const map = new Map<string, Category>()

  rawCategories.forEach((category) => {
    if (!category?.id || !category?.name) {
      return
    }

    map.set(category.id, {
      ...category,
      createdAt: toIso(category.createdAt),
    })
  })

  map.set(DEFAULT_MAIN_CATEGORY_ID, {
    id: DEFAULT_MAIN_CATEGORY_ID,
    name: map.get(DEFAULT_MAIN_CATEGORY_ID)?.name || '메인',
    isSystem: true,
    createdAt: toIso(map.get(DEFAULT_MAIN_CATEGORY_ID)?.createdAt),
  })

  map.set(DEFAULT_WAREHOUSE_CATEGORY_ID, {
    id: DEFAULT_WAREHOUSE_CATEGORY_ID,
    name: map.get(DEFAULT_WAREHOUSE_CATEGORY_ID)?.name || '창고',
    isSystem: true,
    createdAt: toIso(map.get(DEFAULT_WAREHOUSE_CATEGORY_ID)?.createdAt),
  })

  const custom = Array.from(map.values()).filter(
    (category) => category.id !== DEFAULT_MAIN_CATEGORY_ID && category.id !== DEFAULT_WAREHOUSE_CATEGORY_ID,
  )

  return [map.get(DEFAULT_MAIN_CATEGORY_ID)!, map.get(DEFAULT_WAREHOUSE_CATEGORY_ID)!, ...custom]
}

const resolveFallbackCategories = (): { categories: Category[]; selectedCategoryId: CategoryId } => {
  const categories = ensureSystemCategories(loadCategories())
  const selectedCategoryId = loadSelectedCategoryId()
  const resolvedSelectedCategoryId =
    selectedCategoryId && categories.some((category) => category.id === selectedCategoryId)
      ? selectedCategoryId
      : DEFAULT_MAIN_CATEGORY_ID

  return {
    categories,
    selectedCategoryId: resolvedSelectedCategoryId,
  }
}

const mapUnifiedItemToGithubCard = (item: UnifiedItem): GitHubRepoCard => {
  const rawCard = (item.raw?.card ?? null) as Partial<GitHubRepoCard> | null

  if (rawCard && typeof rawCard === 'object' && rawCard.id) {
    const rawId = String(rawCard.id).toLowerCase()
    const [rawOwner = '', rawRepo = ''] = rawId.split('/')

    return {
      id: rawId,
      categoryId: rawCard.categoryId || DEFAULT_MAIN_CATEGORY_ID,
      owner: rawCard.owner || rawOwner,
      repo: rawCard.repo || rawRepo,
      fullName: rawCard.fullName || rawId,
      description: rawCard.description || item.description || '',
      summary: rawCard.summary || item.summary || '',
      htmlUrl: rawCard.htmlUrl || item.url || `https://github.com/${rawId}`,
      homepage: rawCard.homepage ?? null,
      language: rawCard.language || item.language || null,
      stars: Number(rawCard.stars ?? item.metrics?.stars ?? 0),
      forks: Number(rawCard.forks ?? item.metrics?.forks ?? 0),
      watchers: Number(rawCard.watchers ?? item.metrics?.watchers ?? 0),
      openIssues: Number(rawCard.openIssues ?? 0),
      topics: Array.isArray(rawCard.topics) ? rawCard.topics : item.tags || [],
      license: rawCard.license ?? null,
      defaultBranch: rawCard.defaultBranch || 'main',
      createdAt: toIso(rawCard.createdAt || item.createdAt),
      updatedAt: toIso(rawCard.updatedAt || item.updatedAt),
      addedAt: toIso(rawCard.addedAt || item.savedAt),
    }
  }

  const nativeId = String(item.nativeId || '').toLowerCase()
  const [owner = '', repo = ''] = nativeId.split('/')

  return {
    id: nativeId,
    categoryId: (item.raw?.categoryId as CategoryId | undefined) || DEFAULT_MAIN_CATEGORY_ID,
    owner,
    repo,
    fullName: item.title || nativeId,
    description: item.description || '',
    summary: item.summary || '',
    htmlUrl: item.url || `https://github.com/${nativeId}`,
    homepage: null,
    language: item.language || null,
    stars: Number(item.metrics?.stars ?? 0),
    forks: Number(item.metrics?.forks ?? 0),
    watchers: Number(item.metrics?.watchers ?? 0),
    openIssues: 0,
    topics: Array.isArray(item.tags) ? item.tags : [],
    license: null,
    defaultBranch: 'main',
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
    addedAt: toIso(item.savedAt),
  }
}

const toUnifiedGithubItem = (card: GitHubRepoCard, sortIndex: number): UnifiedItem => {
  const normalizedId = card.id.toLowerCase()

  return {
    id: `github:${normalizedId}`,
    provider: 'github',
    type: 'repository',
    nativeId: normalizedId,
    title: card.fullName || normalizedId,
    summary: card.summary || '',
    description: card.description || '',
    url: card.htmlUrl || `https://github.com/${normalizedId}`,
    tags: Array.isArray(card.topics) ? card.topics : [],
    author: card.owner || null,
    language: card.language || null,
    metrics: {
      stars: Number(card.stars || 0),
      forks: Number(card.forks || 0),
      watchers: Number(card.watchers || 0),
    },
    status: 'active',
    createdAt: toIso(card.createdAt),
    updatedAt: toIso(card.updatedAt),
    savedAt: toIso(card.addedAt),
    raw: {
      categoryId: card.categoryId,
      sortIndex,
      card: {
        ...card,
        id: normalizedId,
      },
    },
  }
}

const loadGithubDashboardFromLegacyApi = async (): Promise<GitHubDashboardSnapshot> => {
  const itemsResponse = await requestWithRetry('/api/providers/github/items?limit=1000')

  if (!itemsResponse.ok) {
    throw new Error(await parseErrorMessage(itemsResponse, '대시보드 데이터를 불러오지 못했습니다.'))
  }

  const itemsPayload = (await itemsResponse.json()) as ApiResponse<{ items: UnifiedItem[] }>
  const cards = Array.isArray(itemsPayload.items)
    ? itemsPayload.items.filter((item) => item.provider === 'github').map(mapUnifiedItemToGithubCard)
    : []

  const notesByRepo: GitHubDashboardSnapshot['notesByRepo'] = {}
  const notesResponse = await requestWithRetry('/api/providers/github/notes?limit=3000')

  if (notesResponse.ok) {
    const notesPayload = (await notesResponse.json()) as ProviderNotesPayload

    for (const note of notesPayload.notes || []) {
      const repoId = String(note.itemId || '').replace(/^github:/, '')
      const content = typeof note.content === 'string' ? note.content.trim() : ''

      if (!repoId || !content) {
        continue
      }

      const current = notesByRepo[repoId] || []
      current.push({
        id: String(note.id || `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        repoId,
        content,
        createdAt: toIso(note.createdAt),
      })
      notesByRepo[repoId] = current
    }
  }

  const { categories, selectedCategoryId } = resolveFallbackCategories()

  return {
    cards,
    notesByRepo,
    categories,
    selectedCategoryId,
  }
}

const saveGithubDashboardToLegacyApi = async (dashboard: GitHubDashboardSnapshot): Promise<void> => {
  const items = dashboard.cards.map((card, index) => toUnifiedGithubItem(card, index))
  const notesByItem = Object.fromEntries(
    Object.entries(dashboard.notesByRepo).map(([repoId, notes]) => [
      `github:${repoId}`,
      (notes || []).map((note) => ({
        id: note.id,
        content: note.content,
        createdAt: toIso(note.createdAt),
      })),
    ]),
  )

  const response = await requestWithRetry('/api/providers/github/snapshot', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items, notesByItem }),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '대시보드 저장에 실패했습니다.'))
  }
}

export const loadGithubDashboardFromRemote = async (): Promise<GitHubDashboardSnapshot | null> => {
  if (!isRemoteSnapshotEnabled()) {
    return null
  }

  const response = await requestWithRetry('/api/github/dashboard')

  if (response.status === 404) {
    return loadGithubDashboardFromLegacyApi()
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '대시보드 데이터를 불러오지 못했습니다.'))
  }

  const payload = (await response.json()) as ApiResponse<{ dashboard: GitHubDashboardSnapshot }>

  if (!payload.ok) {
    throw new Error(payload.message || '대시보드 데이터를 불러오지 못했습니다.')
  }

  return payload.dashboard
}

export const saveGithubDashboardToRemote = async (dashboard: GitHubDashboardSnapshot): Promise<void> => {
  if (!isRemoteSnapshotEnabled()) {
    return
  }

  const response = await requestWithRetry('/api/github/dashboard', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dashboard }),
  })

  if (response.status === 404) {
    await saveGithubDashboardToLegacyApi(dashboard)
    return
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '대시보드 저장에 실패했습니다.'))
  }
}

export const searchUnifiedItems = async (params: UnifiedSearchParams): Promise<UnifiedItem[]> => {
  if (!isRemoteSnapshotEnabled()) {
    return []
  }

  const search = new URLSearchParams()
  search.set('q', params.query)

  if (params.provider && params.provider !== 'all') {
    search.set('provider', params.provider)
  }

  if (params.type && params.type !== 'all') {
    search.set('type', params.type)
  }

  search.set('limit', String(params.limit ?? 50))

  if (params.mode) {
    search.set('mode', params.mode)
  }

  if (typeof params.fuzzy === 'boolean') {
    search.set('fuzzy', String(params.fuzzy))
  }

  if (typeof params.prefix === 'boolean') {
    search.set('prefix', String(params.prefix))
  }

  if (typeof params.minScore === 'number' && Number.isFinite(params.minScore)) {
    search.set('min_score', String(params.minScore))
  }

  const response = await requestWithRetry(`/api/search?${search.toString()}`)

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '통합 검색에 실패했습니다.'))
  }

  const payload = (await response.json()) as ApiResponse<{ items: UnifiedItem[] }>

  return payload.ok ? payload.items : []
}

export const exportUnifiedBackup = async (): Promise<UnifiedBackupPayload> => {
  if (!isRemoteSnapshotEnabled()) {
    throw new Error('원격 DB API가 설정되지 않았습니다.')
  }

  const response = await requestWithRetry('/api/admin/export')

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '백업 내보내기에 실패했습니다.'))
  }

  return (await response.json()) as UnifiedBackupPayload
}

export const importUnifiedBackup = async (payload: UnifiedBackupPayload): Promise<void> => {
  if (!isRemoteSnapshotEnabled()) {
    throw new Error('원격 DB API가 설정되지 않았습니다.')
  }

  const response = await requestWithRetry('/api/admin/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '백업 복원에 실패했습니다.'))
  }
}

export { getRemoteBaseUrl }
