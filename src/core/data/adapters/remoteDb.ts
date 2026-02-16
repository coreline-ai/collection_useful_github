import type {
  BookmarkCard,
  BookmarkLinkStatus,
  BookmarkDashboardSnapshot,
  Category,
  CategoryId,
  GitHubRepoCard,
  GitHubDashboardSnapshot,
  ProviderType,
  UnifiedItem,
  UnifiedItemType,
  YouTubeDashboardSnapshot,
  YouTubeVideoCard,
} from '@shared/types'
import { DEFAULT_MAIN_CATEGORY_ID, DEFAULT_WAREHOUSE_CATEGORY_ID } from '@constants'
import {
  loadBookmarkCategories,
  loadBookmarkSelectedCategoryId,
  loadCategories,
  loadSelectedCategoryId,
  loadYoutubeCategories,
  loadYoutubeSelectedCategoryId,
} from '@shared/storage/localStorage'

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

export type BookmarkCardDraft = Omit<
  BookmarkCard,
  'categoryId' | 'addedAt' | 'linkStatus' | 'lastCheckedAt' | 'lastStatusCode' | 'lastResolvedUrl'
>

export type BookmarkLinkCheckResult = {
  checkedUrl: string
  resolvedUrl: string
  status: BookmarkLinkStatus
  statusCode: number | null
  lastCheckedAt: string
}

type ApiResponse<T> = {
  ok: boolean
  message?: string
} & T

type ProviderNotesPayload = ApiResponse<{
  notes: Array<{ id: string; itemId: string; content: string; createdAt: string }>
}>

type SaveDashboardResponse = {
  revision: number
}

const getRemoteBaseUrl = (): string | null => {
  const value = (import.meta.env.VITE_POSTGRES_SYNC_API_BASE_URL as string | undefined)?.trim()

  if (!value) {
    return null
  }

  return value.replace(/\/+$/, '')
}

export const isRemoteSnapshotEnabled = (): boolean => Boolean(getRemoteBaseUrl())

const getRemoteApiToken = (): string => {
  const token = (import.meta.env.VITE_POSTGRES_SYNC_API_TOKEN as string | undefined)?.trim()
  return token || ''
}

const getRemoteRequestTimeoutMs = (): number => {
  const raw = Number(import.meta.env.VITE_POSTGRES_SYNC_TIMEOUT_SECONDS as string | undefined)
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : 12
  return Math.floor(seconds * 1000)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const requestWithRetry = async (path: string, init?: RequestInit, retries = 2): Promise<Response> => {
  const baseUrl = getRemoteBaseUrl()
  const apiToken = getRemoteApiToken()
  const timeoutMs = getRemoteRequestTimeoutMs()

  if (!baseUrl) {
    throw new Error('원격 DB API가 설정되지 않았습니다.')
  }

  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const headers = new Headers(init?.headers)
      if (apiToken) {
        headers.set('x-admin-token', apiToken)
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      const originalSignal = init?.signal
      const abortFromOriginal = () => controller.abort()
      if (originalSignal) {
        if (originalSignal.aborted) {
          controller.abort()
        } else {
          originalSignal.addEventListener('abort', abortFromOriginal, { once: true })
        }
      }

      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      }).finally(() => {
        clearTimeout(timeoutId)
        if (originalSignal) {
          originalSignal.removeEventListener('abort', abortFromOriginal)
        }
      })

      if (response.status >= 500 && attempt < retries) {
        await wait(200 * (attempt + 1))
        continue
      }

      return response
    } catch (error) {
      const isAbortError =
        error instanceof DOMException
          ? error.name === 'AbortError'
          : error instanceof Error && error.name === 'AbortError'
      lastError = isAbortError ? new Error('원격 API 요청 timeout') : error

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

const createResponseError = async (response: Response, fallback: string): Promise<Error & { status: number }> => {
  const error = new Error(await parseErrorMessage(response, fallback)) as Error & { status: number }
  error.status = response.status
  return error
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

const resolveFallbackYoutubeCategories = (): { categories: Category[]; selectedCategoryId: CategoryId } => {
  const categories = ensureSystemCategories(loadYoutubeCategories())
  const selectedCategoryId = loadYoutubeSelectedCategoryId()
  const resolvedSelectedCategoryId =
    selectedCategoryId && categories.some((category) => category.id === selectedCategoryId)
      ? selectedCategoryId
      : DEFAULT_MAIN_CATEGORY_ID

  return {
    categories,
    selectedCategoryId: resolvedSelectedCategoryId,
  }
}

const resolveFallbackBookmarkCategories = (): { categories: Category[]; selectedCategoryId: CategoryId } => {
  const categories = ensureSystemCategories(loadBookmarkCategories())
  const selectedCategoryId = loadBookmarkSelectedCategoryId()
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

const toUnifiedYoutubeItem = (card: YouTubeVideoCard, sortIndex: number): UnifiedItem => {
  const normalizedVideoId = card.videoId || card.id
  const normalizedDescription = card.description.replace(/\s+/g, ' ').trim()
  const summary =
    normalizedDescription.length === 0
      ? '영상 설명이 없습니다.'
      : normalizedDescription.length <= 180
        ? normalizedDescription
        : `${normalizedDescription.slice(0, 177)}...`

  return {
    id: `youtube:${normalizedVideoId}`,
    provider: 'youtube',
    type: 'video',
    nativeId: normalizedVideoId,
    title: card.title,
    summary,
    description: card.description,
    url: card.videoUrl,
    tags: [],
    author: card.channelTitle,
    language: null,
    metrics: {
      views: card.viewCount,
      likes: card.likeCount ?? undefined,
    },
    status: card.categoryId === 'warehouse' ? 'archived' : 'active',
    createdAt: toIso(card.publishedAt),
    updatedAt: toIso(card.updatedAt),
    savedAt: toIso(card.addedAt),
    raw: {
      categoryId: card.categoryId,
      sortIndex,
      card: {
        ...card,
        id: card.id || normalizedVideoId,
        videoId: normalizedVideoId,
      },
    },
  }
}

const mapUnifiedItemToYoutubeCard = (item: UnifiedItem): YouTubeVideoCard => {
  const rawCard = (item.raw?.card ?? null) as Partial<YouTubeVideoCard> | null

  if (rawCard && typeof rawCard === 'object' && rawCard.videoId) {
    const videoId = String(rawCard.videoId)
    return {
      id: String(rawCard.id || videoId),
      videoId,
      categoryId: rawCard.categoryId || DEFAULT_MAIN_CATEGORY_ID,
      title: String(rawCard.title || item.title || ''),
      channelTitle: String(rawCard.channelTitle || item.author || ''),
      description: String(rawCard.description || item.description || ''),
      thumbnailUrl: String(rawCard.thumbnailUrl || ''),
      videoUrl: String(rawCard.videoUrl || item.url || `https://www.youtube.com/watch?v=${videoId}`),
      publishedAt: toIso(rawCard.publishedAt || item.createdAt),
      viewCount: Number(rawCard.viewCount ?? item.metrics?.views ?? 0),
      likeCount:
        typeof rawCard.likeCount === 'number'
          ? Number(rawCard.likeCount)
          : typeof item.metrics?.likes === 'number'
            ? Number(item.metrics.likes)
            : null,
      addedAt: toIso(rawCard.addedAt || item.savedAt),
      updatedAt: toIso(rawCard.updatedAt || item.updatedAt),
    }
  }

  const videoId = String(item.nativeId || '')

  return {
    id: videoId,
    videoId,
    categoryId: (item.raw?.categoryId as CategoryId | undefined) || DEFAULT_MAIN_CATEGORY_ID,
    title: item.title || '',
    channelTitle: item.author || '',
    description: item.description || '',
    thumbnailUrl: '',
    videoUrl: item.url || `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt: toIso(item.createdAt),
    viewCount: Number(item.metrics?.views ?? 0),
    likeCount: typeof item.metrics?.likes === 'number' ? Number(item.metrics.likes) : null,
    addedAt: toIso(item.savedAt),
    updatedAt: toIso(item.updatedAt),
  }
}

const toUnifiedBookmarkItem = (card: BookmarkCard, sortIndex: number): UnifiedItem => {
  return {
    id: `bookmark:${card.normalizedUrl}`,
    provider: 'bookmark',
    type: 'bookmark',
    nativeId: card.normalizedUrl,
    title: card.title,
    summary: card.excerpt,
    description: card.excerpt,
    url: card.url,
    tags: Array.isArray(card.tags) ? card.tags : [],
    author: card.domain,
    language: null,
    metrics: {},
    status: card.categoryId === 'warehouse' ? 'archived' : 'active',
    createdAt: toIso(card.addedAt),
    updatedAt: toIso(card.updatedAt),
    savedAt: toIso(card.addedAt),
    raw: {
      categoryId: card.categoryId,
      metadataStatus: card.metadataStatus,
      linkStatus: card.linkStatus,
      lastCheckedAt: card.lastCheckedAt,
      lastStatusCode: card.lastStatusCode,
      lastResolvedUrl: card.lastResolvedUrl,
      sortIndex,
      card,
    },
  }
}

const mapUnifiedItemToBookmarkCard = (item: UnifiedItem): BookmarkCard => {
  const rawCard = (item.raw?.card ?? null) as Partial<BookmarkCard> | null

  if (rawCard && typeof rawCard === 'object' && rawCard.normalizedUrl) {
    const normalizedUrl = String(rawCard.normalizedUrl)

    return {
      id: String(rawCard.id || normalizedUrl),
      categoryId: rawCard.categoryId || DEFAULT_MAIN_CATEGORY_ID,
      url: String(rawCard.url || item.url || normalizedUrl),
      normalizedUrl,
      canonicalUrl: rawCard.canonicalUrl ? String(rawCard.canonicalUrl) : null,
      domain: String(rawCard.domain || item.author || ''),
      title: String(rawCard.title || item.title || normalizedUrl),
      excerpt: String(rawCard.excerpt || item.summary || item.description || ''),
      thumbnailUrl: rawCard.thumbnailUrl ? String(rawCard.thumbnailUrl) : null,
      faviconUrl: rawCard.faviconUrl ? String(rawCard.faviconUrl) : null,
      tags: Array.isArray(rawCard.tags) ? rawCard.tags.map((tag) => String(tag)) : item.tags || [],
      addedAt: toIso(rawCard.addedAt || item.savedAt),
      updatedAt: toIso(rawCard.updatedAt || item.updatedAt),
      metadataStatus: rawCard.metadataStatus === 'ok' ? 'ok' : 'fallback',
      linkStatus:
        rawCard.linkStatus === 'ok' ||
        rawCard.linkStatus === 'redirected' ||
        rawCard.linkStatus === 'blocked' ||
        rawCard.linkStatus === 'not_found' ||
        rawCard.linkStatus === 'timeout' ||
        rawCard.linkStatus === 'error'
          ? rawCard.linkStatus
          : 'unknown',
      lastCheckedAt: rawCard.lastCheckedAt ? toIso(rawCard.lastCheckedAt) : null,
      lastStatusCode:
        typeof rawCard.lastStatusCode === 'number' && Number.isFinite(rawCard.lastStatusCode)
          ? Number(rawCard.lastStatusCode)
          : null,
      lastResolvedUrl: rawCard.lastResolvedUrl ? String(rawCard.lastResolvedUrl) : null,
    }
  }

  const normalizedUrl = String(item.nativeId || item.url || '')
  const domain = item.author || ''
  const excerpt = item.summary || item.description || '미리보기를 가져오지 못했습니다.'

  return {
    id: normalizedUrl,
    categoryId: (item.raw?.categoryId as CategoryId | undefined) || DEFAULT_MAIN_CATEGORY_ID,
    url: item.url || normalizedUrl,
    normalizedUrl,
    canonicalUrl: null,
    domain,
    title: item.title || domain || normalizedUrl,
    excerpt,
    thumbnailUrl: null,
    faviconUrl: null,
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag)) : [],
    addedAt: toIso(item.savedAt),
    updatedAt: toIso(item.updatedAt),
    metadataStatus: item.raw?.metadataStatus === 'ok' ? 'ok' : 'fallback',
    linkStatus:
      item.raw?.linkStatus === 'ok' ||
      item.raw?.linkStatus === 'redirected' ||
      item.raw?.linkStatus === 'blocked' ||
      item.raw?.linkStatus === 'not_found' ||
      item.raw?.linkStatus === 'timeout' ||
      item.raw?.linkStatus === 'error'
        ? item.raw.linkStatus
        : 'unknown',
    lastCheckedAt: item.raw?.lastCheckedAt ? toIso(item.raw.lastCheckedAt) : null,
    lastStatusCode:
      typeof item.raw?.lastStatusCode === 'number' && Number.isFinite(item.raw.lastStatusCode)
        ? Number(item.raw.lastStatusCode)
        : null,
    lastResolvedUrl: typeof item.raw?.lastResolvedUrl === 'string' ? item.raw.lastResolvedUrl : null,
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

const loadYoutubeDashboardFromLegacyApi = async (): Promise<YouTubeDashboardSnapshot> => {
  const itemsResponse = await requestWithRetry('/api/providers/youtube/items?limit=1000')

  if (!itemsResponse.ok) {
    throw new Error(await parseErrorMessage(itemsResponse, '유튜브 대시보드 데이터를 불러오지 못했습니다.'))
  }

  const itemsPayload = (await itemsResponse.json()) as ApiResponse<{ items: UnifiedItem[] }>
  const cards = Array.isArray(itemsPayload.items)
    ? itemsPayload.items.filter((item) => item.provider === 'youtube').map(mapUnifiedItemToYoutubeCard)
    : []

  const { categories, selectedCategoryId } = resolveFallbackYoutubeCategories()

  return {
    cards,
    categories,
    selectedCategoryId,
  }
}

const saveYoutubeDashboardToLegacyApi = async (dashboard: YouTubeDashboardSnapshot): Promise<void> => {
  const items = dashboard.cards.map((card, index) => toUnifiedYoutubeItem(card, index))

  const response = await requestWithRetry('/api/providers/youtube/snapshot', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items, notesByItem: {} }),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '유튜브 대시보드 저장에 실패했습니다.'))
  }
}

const loadBookmarkDashboardFromLegacyApi = async (): Promise<BookmarkDashboardSnapshot> => {
  const itemsResponse = await requestWithRetry('/api/providers/bookmark/items?limit=1000')

  if (!itemsResponse.ok) {
    throw new Error(await parseErrorMessage(itemsResponse, '북마크 대시보드 데이터를 불러오지 못했습니다.'))
  }

  const itemsPayload = (await itemsResponse.json()) as ApiResponse<{ items: UnifiedItem[] }>
  const cards = Array.isArray(itemsPayload.items)
    ? itemsPayload.items.filter((item) => item.provider === 'bookmark').map(mapUnifiedItemToBookmarkCard)
    : []

  const { categories, selectedCategoryId } = resolveFallbackBookmarkCategories()

  return {
    cards,
    categories,
    selectedCategoryId,
  }
}

const saveBookmarkDashboardToLegacyApi = async (dashboard: BookmarkDashboardSnapshot): Promise<void> => {
  const items = dashboard.cards.map((card, index) => toUnifiedBookmarkItem(card, index))

  const response = await requestWithRetry('/api/providers/bookmark/snapshot', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items, notesByItem: {} }),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '북마크 대시보드 저장에 실패했습니다.'))
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

export const saveGithubDashboardToRemote = async (
  dashboard: GitHubDashboardSnapshot,
  expectedRevision: number | null = null,
): Promise<number | null> => {
  if (!isRemoteSnapshotEnabled()) {
    return null
  }

  const response = await requestWithRetry('/api/github/dashboard', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dashboard, expectedRevision }),
  })

  if (response.status === 404) {
    await saveGithubDashboardToLegacyApi(dashboard)
    return null
  }

  if (!response.ok) {
    throw await createResponseError(response, '대시보드 저장에 실패했습니다.')
  }

  const payload = (await response.json()) as ApiResponse<SaveDashboardResponse>
  return typeof payload.revision === 'number' && Number.isFinite(payload.revision) ? payload.revision : null
}

export const loadYoutubeDashboardFromRemote = async (): Promise<YouTubeDashboardSnapshot | null> => {
  if (!isRemoteSnapshotEnabled()) {
    return null
  }

  const response = await requestWithRetry('/api/youtube/dashboard')

  if (response.status === 404) {
    return loadYoutubeDashboardFromLegacyApi()
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '유튜브 대시보드 데이터를 불러오지 못했습니다.'))
  }

  const payload = (await response.json()) as ApiResponse<{ dashboard: YouTubeDashboardSnapshot }>

  if (!payload.ok) {
    throw new Error(payload.message || '유튜브 대시보드 데이터를 불러오지 못했습니다.')
  }

  return payload.dashboard
}

export const saveYoutubeDashboardToRemote = async (
  dashboard: YouTubeDashboardSnapshot,
  expectedRevision: number | null = null,
): Promise<number | null> => {
  if (!isRemoteSnapshotEnabled()) {
    return null
  }

  const response = await requestWithRetry('/api/youtube/dashboard', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dashboard, expectedRevision }),
  })

  if (response.status === 404) {
    await saveYoutubeDashboardToLegacyApi(dashboard)
    return null
  }

  if (!response.ok) {
    throw await createResponseError(response, '유튜브 대시보드 저장에 실패했습니다.')
  }

  const payload = (await response.json()) as ApiResponse<SaveDashboardResponse>
  return typeof payload.revision === 'number' && Number.isFinite(payload.revision) ? payload.revision : null
}

export const loadBookmarkDashboardFromRemote = async (): Promise<BookmarkDashboardSnapshot | null> => {
  if (!isRemoteSnapshotEnabled()) {
    return null
  }

  const response = await requestWithRetry('/api/bookmark/dashboard')

  if (response.status === 404) {
    return loadBookmarkDashboardFromLegacyApi()
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '북마크 대시보드 데이터를 불러오지 못했습니다.'))
  }

  const payload = (await response.json()) as ApiResponse<{ dashboard: BookmarkDashboardSnapshot }>

  if (!payload.ok) {
    throw new Error(payload.message || '북마크 대시보드 데이터를 불러오지 못했습니다.')
  }

  return payload.dashboard
}

export const saveBookmarkDashboardToRemote = async (
  dashboard: BookmarkDashboardSnapshot,
  expectedRevision: number | null = null,
): Promise<number | null> => {
  if (!isRemoteSnapshotEnabled()) {
    return null
  }

  const response = await requestWithRetry('/api/bookmark/dashboard', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dashboard, expectedRevision }),
  })

  if (response.status === 404) {
    await saveBookmarkDashboardToLegacyApi(dashboard)
    return null
  }

  if (!response.ok) {
    throw await createResponseError(response, '북마크 대시보드 저장에 실패했습니다.')
  }

  const payload = (await response.json()) as ApiResponse<SaveDashboardResponse>
  return typeof payload.revision === 'number' && Number.isFinite(payload.revision) ? payload.revision : null
}

export const fetchBookmarkMetadata = async (url: string): Promise<BookmarkCardDraft> => {
  if (!isRemoteSnapshotEnabled()) {
    throw new Error('원격 DB API가 설정되지 않았습니다.')
  }

  const response = await requestWithRetry(`/api/bookmark/metadata?url=${encodeURIComponent(url)}`)

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '북마크 메타데이터를 불러오지 못했습니다.'))
  }

  const payload = (await response.json()) as ApiResponse<{
    metadata: {
      url: string
      normalizedUrl: string
      canonicalUrl: string | null
      domain: string
      title: string
      excerpt: string
      thumbnailUrl: string | null
      faviconUrl: string | null
      tags: string[]
      metadataStatus: 'ok' | 'fallback'
      updatedAt: string
    }
  }>

  if (!payload.ok || !payload.metadata) {
    throw new Error(payload.message || '북마크 메타데이터를 불러오지 못했습니다.')
  }

  return {
    id: payload.metadata.normalizedUrl,
    url: payload.metadata.url,
    normalizedUrl: payload.metadata.normalizedUrl,
    canonicalUrl: payload.metadata.canonicalUrl,
    domain: payload.metadata.domain,
    title: payload.metadata.title,
    excerpt: payload.metadata.excerpt,
    thumbnailUrl: payload.metadata.thumbnailUrl,
    faviconUrl: payload.metadata.faviconUrl,
    tags: Array.isArray(payload.metadata.tags) ? payload.metadata.tags : [],
    updatedAt: payload.metadata.updatedAt,
    metadataStatus: payload.metadata.metadataStatus === 'ok' ? 'ok' : 'fallback',
  }
}

export const checkBookmarkLinkStatus = async (url: string): Promise<BookmarkLinkCheckResult> => {
  if (!isRemoteSnapshotEnabled()) {
    throw new Error('원격 DB API가 설정되지 않았습니다.')
  }

  const response = await requestWithRetry(`/api/bookmark/link-check?url=${encodeURIComponent(url)}`)

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, '북마크 링크 점검에 실패했습니다.'))
  }

  const payload = (await response.json()) as ApiResponse<{
    result: {
      checkedUrl: string
      resolvedUrl: string
      status: BookmarkLinkStatus
      statusCode: number | null
      lastCheckedAt: string
    }
  }>

  if (!payload.ok || !payload.result) {
    throw new Error(payload.message || '북마크 링크 점검에 실패했습니다.')
  }

  return {
    checkedUrl: payload.result.checkedUrl,
    resolvedUrl: payload.result.resolvedUrl,
    status: payload.result.status,
    statusCode:
      typeof payload.result.statusCode === 'number' && Number.isFinite(payload.result.statusCode)
        ? payload.result.statusCode
        : null,
    lastCheckedAt: toIso(payload.result.lastCheckedAt),
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
