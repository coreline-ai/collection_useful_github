import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import { getClient, query } from './db.js'
import { migrate } from './migrate.js'

dotenv.config()

const PROVIDERS = new Set(['github', 'youtube', 'bookmark'])
const TYPES = new Set(['repository', 'video', 'bookmark'])
const DASHBOARD_META_KEY = 'github_dashboard_v1'
const YOUTUBE_DASHBOARD_META_KEY = 'youtube_dashboard_v1'
const BOOKMARK_DASHBOARD_META_KEY = 'bookmark_dashboard_v1'
const youtubeApiKey = (process.env.YOUTUBE_API_KEY || '').trim()
const adminApiToken = (process.env.ADMIN_API_TOKEN || '').trim()
const youtubeTimeoutSeconds = Number(process.env.YOUTUBE_API_TIMEOUT_SECONDS || 12)
const youtubeTimeoutMs = Number.isFinite(youtubeTimeoutSeconds) && youtubeTimeoutSeconds > 0
  ? Math.floor(youtubeTimeoutSeconds * 1000)
  : 12000
const bookmarkFetchTimeoutMs = Number(process.env.BOOKMARK_FETCH_TIMEOUT_MS || 10_000)
const bookmarkMaxResponseBytes = Number(process.env.BOOKMARK_MAX_RESPONSE_BYTES || 1_048_576)

const DEFAULT_CATEGORIES = [
  {
    id: 'main',
    name: '메인',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
  {
    id: 'warehouse',
    name: '창고',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
]

const app = express()
app.use(express.json({ limit: '8mb' }))

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error('CORS blocked'))
    },
  }),
)

app.use((req, _res, next) => {
  const now = new Date().toISOString()
  console.log(`[${now}] ${req.method} ${req.path}`)
  next()
})

const searchRateLimitMap = new Map()
const SEARCH_LIMIT_WINDOW_MS = 60 * 1000
const SEARCH_LIMIT_MAX = 60

const createHttpError = (status, message) => {
  const error = new Error(message)
  error.status = status
  return error
}

const parseExpectedRevision = (value) => {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw createHttpError(400, 'invalid expectedRevision')
  }

  return parsed
}

const parseMetaRevision = (value) => {
  const revision = Number(value?.revision)
  if (!Number.isInteger(revision) || revision < 0) {
    return 0
  }

  return revision
}

const resolveRequestToken = (req) => {
  const headerToken = String(req.get('x-admin-token') || '').trim()
  if (headerToken) {
    return headerToken
  }

  const authorization = String(req.get('authorization') || '').trim()
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim()
  }

  return ''
}

const requireAdminAuth = (req, _res, next) => {
  if (!adminApiToken) {
    next()
    return
  }

  const token = resolveRequestToken(req)
  if (!token || token !== adminApiToken) {
    next(createHttpError(401, 'unauthorized'))
    return
  }

  next()
}

const parseBoolean = (value, fallback = false) => {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }

  if (normalized === 'false') {
    return false
  }

  return fallback
}

const applySearchRateLimit = (req, _res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const entry = searchRateLimitMap.get(ip)

  if (!entry || now - entry.windowStart >= SEARCH_LIMIT_WINDOW_MS) {
    searchRateLimitMap.set(ip, {
      windowStart: now,
      count: 1,
    })
    next()
    return
  }

  if (entry.count >= SEARCH_LIMIT_MAX) {
    const error = new Error('검색 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
    error.status = 429
    next(error)
    return
  }

  entry.count += 1
  next()
}

const toIso = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }

  return date.toISOString()
}

const ensureProvider = (provider) => {
  if (!PROVIDERS.has(provider)) {
    const error = new Error('invalid provider')
    error.status = 400
    throw error
  }
}

const normalizeItem = (provider, rawItem) => {
  const now = new Date().toISOString()

  return {
    id: String(rawItem.id || `${provider}:${rawItem.nativeId || ''}`),
    provider,
    type: TYPES.has(rawItem.type) ? rawItem.type : 'repository',
    nativeId: String(rawItem.nativeId || ''),
    title: String(rawItem.title || ''),
    summary: String(rawItem.summary || ''),
    description: String(rawItem.description || ''),
    url: String(rawItem.url || ''),
    tags: Array.isArray(rawItem.tags) ? rawItem.tags.map((tag) => String(tag)).slice(0, 100) : [],
    author: rawItem.author ? String(rawItem.author) : null,
    language: rawItem.language ? String(rawItem.language) : null,
    metrics: typeof rawItem.metrics === 'object' && rawItem.metrics !== null ? rawItem.metrics : {},
    status: rawItem.status === 'archived' ? 'archived' : 'active',
    createdAt: toIso(rawItem.createdAt || now),
    updatedAt: toIso(rawItem.updatedAt || now),
    savedAt: toIso(rawItem.savedAt || now),
    raw: typeof rawItem.raw === 'object' && rawItem.raw !== null ? rawItem.raw : {},
  }
}

const buildNoteRecordsFromNotesByRepo = (notesByRepo = {}) => {
  const notes = []

  for (const [repoId, values] of Object.entries(notesByRepo)) {
    if (!Array.isArray(values)) {
      continue
    }

    for (const note of values) {
      const content = typeof note?.content === 'string' ? note.content.trim() : ''

      if (!content) {
        continue
      }

      notes.push({
        id: String(note?.id || `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        provider: 'github',
        itemId: `github:${repoId}`,
        content,
        createdAt: toIso(note?.createdAt || new Date().toISOString()),
      })
    }
  }

  return notes
}

const flattenNotesByItem = (provider, notesByItem = {}) => {
  const notes = []

  for (const [itemId, rawNotes] of Object.entries(notesByItem)) {
    if (!Array.isArray(rawNotes)) {
      continue
    }

    for (const note of rawNotes) {
      const content = typeof note?.content === 'string' ? note.content.trim() : ''
      if (!content) {
        continue
      }

      const noteId = note?.id ? String(note.id) : `${provider}:${itemId}:${notes.length + 1}`
      notes.push({
        id: noteId,
        provider,
        itemId,
        content,
        createdAt: toIso(note?.createdAt || new Date().toISOString()),
      })
    }
  }

  return notes
}

const normalizeCategories = (rawCategories) => {
  const map = new Map()

  for (const category of Array.isArray(rawCategories) ? rawCategories : []) {
    if (!category || typeof category !== 'object') {
      continue
    }

    const id = String(category.id || '')
    const name = String(category.name || '').trim()

    if (!id || !name) {
      continue
    }

    map.set(id, {
      id,
      name,
      isSystem: id === 'main' || id === 'warehouse' ? true : Boolean(category.isSystem),
      createdAt: toIso(category.createdAt || new Date().toISOString()),
    })
  }

  for (const systemCategory of DEFAULT_CATEGORIES) {
    map.set(systemCategory.id, {
      ...systemCategory,
      ...(map.get(systemCategory.id) || {}),
      isSystem: true,
    })
  }

  const customCategories = Array.from(map.values()).filter(
    (category) => category.id !== 'main' && category.id !== 'warehouse',
  )

  return [map.get('main'), map.get('warehouse'), ...customCategories]
}

const normalizeDashboardPayload = (rawDashboard) => {
  const dashboard = rawDashboard && typeof rawDashboard === 'object' ? rawDashboard : {}

  const cards = Array.isArray(dashboard.cards) ? dashboard.cards : []
  const notesByRepo =
    dashboard.notesByRepo && typeof dashboard.notesByRepo === 'object' ? dashboard.notesByRepo : {}

  const categories = normalizeCategories(dashboard.categories)
  const selectedCategoryId = categories.some((category) => category.id === dashboard.selectedCategoryId)
    ? dashboard.selectedCategoryId
    : 'main'

  return {
    cards,
    notesByRepo,
    categories,
    selectedCategoryId,
  }
}

const normalizeYoutubeDashboardPayload = (rawDashboard) => {
  const dashboard = rawDashboard && typeof rawDashboard === 'object' ? rawDashboard : {}
  const cards = Array.isArray(dashboard.cards) ? dashboard.cards : []
  const categories = normalizeCategories(dashboard.categories)
  const selectedCategoryId = categories.some((category) => category.id === dashboard.selectedCategoryId)
    ? dashboard.selectedCategoryId
    : 'main'

  return {
    cards,
    categories,
    selectedCategoryId,
  }
}

const normalizeBookmarkDashboardPayload = (rawDashboard) => {
  const dashboard = rawDashboard && typeof rawDashboard === 'object' ? rawDashboard : {}
  const cards = Array.isArray(dashboard.cards) ? dashboard.cards : []
  const categories = normalizeCategories(dashboard.categories)
  const selectedCategoryId = categories.some((category) => category.id === dashboard.selectedCategoryId)
    ? dashboard.selectedCategoryId
    : 'main'

  return {
    cards,
    categories,
    selectedCategoryId,
  }
}

const toGithubUnifiedItems = (cards) => {
  return cards.map((card, index) => {
    const normalizedCard = {
      id: String(card.id || '').toLowerCase(),
      categoryId: String(card.categoryId || 'main'),
      owner: String(card.owner || ''),
      repo: String(card.repo || ''),
      fullName: String(card.fullName || ''),
      description: String(card.description || ''),
      summary: String(card.summary || ''),
      htmlUrl: String(card.htmlUrl || ''),
      homepage: card.homepage ? String(card.homepage) : null,
      language: card.language ? String(card.language) : null,
      stars: Number(card.stars || 0),
      forks: Number(card.forks || 0),
      watchers: Number(card.watchers || 0),
      openIssues: Number(card.openIssues || 0),
      topics: Array.isArray(card.topics) ? card.topics.map((topic) => String(topic)) : [],
      license: card.license ? String(card.license) : null,
      defaultBranch: String(card.defaultBranch || 'main'),
      createdAt: toIso(card.createdAt || new Date().toISOString()),
      updatedAt: toIso(card.updatedAt || new Date().toISOString()),
      addedAt: toIso(card.addedAt || new Date().toISOString()),
    }

    return normalizeItem('github', {
      id: `github:${normalizedCard.id}`,
      type: 'repository',
      nativeId: normalizedCard.id,
      title: normalizedCard.fullName,
      summary: normalizedCard.summary,
      description: normalizedCard.description,
      url: normalizedCard.htmlUrl,
      tags: normalizedCard.topics,
      author: normalizedCard.owner,
      language: normalizedCard.language,
      metrics: {
        stars: normalizedCard.stars,
        forks: normalizedCard.forks,
        watchers: normalizedCard.watchers,
      },
      status: normalizedCard.categoryId === 'warehouse' ? 'archived' : 'active',
      createdAt: normalizedCard.createdAt,
      updatedAt: normalizedCard.updatedAt,
      savedAt: normalizedCard.addedAt,
      raw: {
        card: normalizedCard,
        categoryId: normalizedCard.categoryId,
        sortIndex: index,
      },
    })
  })
}

const toYoutubeUnifiedItems = (cards) => {
  return cards.map((card, index) => {
    const videoId = String(card.videoId || card.id || '')
    const normalizedCard = {
      id: String(card.id || videoId),
      videoId,
      categoryId: String(card.categoryId || 'main'),
      title: String(card.title || ''),
      channelTitle: String(card.channelTitle || ''),
      description: String(card.description || ''),
      thumbnailUrl: String(card.thumbnailUrl || ''),
      videoUrl: String(card.videoUrl || `https://www.youtube.com/watch?v=${videoId}`),
      publishedAt: toIso(card.publishedAt || new Date().toISOString()),
      viewCount: Number(card.viewCount || 0),
      likeCount:
        typeof card.likeCount === 'number' && Number.isFinite(card.likeCount)
          ? Number(card.likeCount)
          : null,
      addedAt: toIso(card.addedAt || new Date().toISOString()),
      updatedAt: toIso(card.updatedAt || card.publishedAt || new Date().toISOString()),
    }

    const summary = normalizedCard.description
      ? normalizedCard.description.replace(/\s+/g, ' ').trim().slice(0, 180)
      : '영상 설명이 없습니다.'

    return normalizeItem('youtube', {
      id: `youtube:${videoId}`,
      type: 'video',
      nativeId: videoId,
      title: normalizedCard.title,
      summary: summary.length < normalizedCard.description.length ? `${summary.slice(0, 177)}...` : summary,
      description: normalizedCard.description,
      url: normalizedCard.videoUrl,
      tags: [],
      author: normalizedCard.channelTitle,
      language: null,
      metrics: {
        views: normalizedCard.viewCount,
        likes: normalizedCard.likeCount,
      },
      status: normalizedCard.categoryId === 'warehouse' ? 'archived' : 'active',
      createdAt: normalizedCard.publishedAt,
      updatedAt: normalizedCard.updatedAt,
      savedAt: normalizedCard.addedAt,
      raw: {
        card: normalizedCard,
        categoryId: normalizedCard.categoryId,
        sortIndex: index,
      },
    })
  })
}

const toBookmarkUnifiedItems = (cards) => {
  return cards.map((card, index) => {
    const normalizedUrl = String(card.normalizedUrl || card.id || '').trim()
    const normalizedCard = {
      id: String(card.id || normalizedUrl),
      normalizedUrl,
      categoryId: String(card.categoryId || 'main'),
      url: String(card.url || normalizedUrl),
      canonicalUrl: card.canonicalUrl ? String(card.canonicalUrl) : null,
      domain: String(card.domain || ''),
      title: String(card.title || card.domain || normalizedUrl),
      excerpt: String(card.excerpt || ''),
      thumbnailUrl: card.thumbnailUrl ? String(card.thumbnailUrl) : null,
      faviconUrl: card.faviconUrl ? String(card.faviconUrl) : null,
      tags: Array.isArray(card.tags) ? card.tags.map((tag) => String(tag)) : [],
      addedAt: toIso(card.addedAt || new Date().toISOString()),
      updatedAt: toIso(card.updatedAt || new Date().toISOString()),
      metadataStatus: card.metadataStatus === 'ok' ? 'ok' : 'fallback',
      linkStatus:
        card.linkStatus === 'ok' ||
        card.linkStatus === 'redirected' ||
        card.linkStatus === 'blocked' ||
        card.linkStatus === 'not_found' ||
        card.linkStatus === 'timeout' ||
        card.linkStatus === 'error'
          ? card.linkStatus
          : 'unknown',
      lastCheckedAt: card.lastCheckedAt ? toIso(card.lastCheckedAt) : null,
      lastStatusCode:
        typeof card.lastStatusCode === 'number' && Number.isFinite(card.lastStatusCode)
          ? Number(card.lastStatusCode)
          : null,
      lastResolvedUrl: card.lastResolvedUrl ? String(card.lastResolvedUrl) : null,
    }

    return normalizeItem('bookmark', {
      id: `bookmark:${normalizedCard.normalizedUrl}`,
      type: 'bookmark',
      nativeId: normalizedCard.normalizedUrl,
      title: normalizedCard.title,
      summary: normalizedCard.excerpt,
      description: normalizedCard.excerpt,
      url: normalizedCard.url,
      tags: normalizedCard.tags,
      author: normalizedCard.domain,
      language: null,
      metrics: {},
      status: normalizedCard.categoryId === 'warehouse' ? 'archived' : 'active',
      createdAt: normalizedCard.addedAt,
      updatedAt: normalizedCard.updatedAt,
      savedAt: normalizedCard.addedAt,
      raw: {
        card: normalizedCard,
        categoryId: normalizedCard.categoryId,
        sortIndex: index,
        metadataStatus: normalizedCard.metadataStatus,
        linkStatus: normalizedCard.linkStatus,
        lastCheckedAt: normalizedCard.lastCheckedAt,
        lastStatusCode: normalizedCard.lastStatusCode,
        lastResolvedUrl: normalizedCard.lastResolvedUrl,
      },
    })
  })
}

const mapItemRowToGithubCard = (row) => {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {}

  if (raw.card && typeof raw.card === 'object') {
    const card = raw.card

    return {
      ...card,
      id: String(card.id || row.nativeId).toLowerCase(),
      categoryId: String(card.categoryId || raw.categoryId || 'main'),
      owner: String(card.owner || ''),
      repo: String(card.repo || ''),
      fullName: String(card.fullName || row.title || ''),
      description: String(card.description || row.description || ''),
      summary: String(card.summary || row.summary || ''),
      htmlUrl: String(card.htmlUrl || row.url || ''),
      homepage: card.homepage ? String(card.homepage) : null,
      language: card.language ? String(card.language) : null,
      stars: Number(card.stars || row.metrics?.stars || 0),
      forks: Number(card.forks || row.metrics?.forks || 0),
      watchers: Number(card.watchers || row.metrics?.watchers || 0),
      openIssues: Number(card.openIssues || 0),
      topics: Array.isArray(card.topics) ? card.topics.map((topic) => String(topic)) : row.tags || [],
      license: card.license ? String(card.license) : null,
      defaultBranch: String(card.defaultBranch || 'main'),
      createdAt: toIso(card.createdAt || row.createdAt),
      updatedAt: toIso(card.updatedAt || row.updatedAt),
      addedAt: toIso(card.addedAt || row.savedAt),
    }
  }

  const [owner = '', repo = ''] = String(row.nativeId || '').split('/')

  return {
    id: String(row.nativeId || '').toLowerCase(),
    categoryId: String(raw.categoryId || 'main'),
    owner,
    repo,
    fullName: String(row.title || row.nativeId || ''),
    description: String(row.description || ''),
    summary: String(row.summary || ''),
    htmlUrl: String(row.url || ''),
    homepage: raw.homepage ? String(raw.homepage) : null,
    language: row.language ? String(row.language) : null,
    stars: Number(row.metrics?.stars || 0),
    forks: Number(row.metrics?.forks || 0),
    watchers: Number(row.metrics?.watchers || 0),
    openIssues: Number(raw.openIssues || 0),
    topics: Array.isArray(row.tags) ? row.tags.map((topic) => String(topic)) : [],
    license: raw.license ? String(raw.license) : null,
    defaultBranch: String(raw.defaultBranch || 'main'),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    addedAt: toIso(row.savedAt),
  }
}

const mapItemRowToYoutubeCard = (row) => {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {}

  if (raw.card && typeof raw.card === 'object') {
    const card = raw.card

    return {
      id: String(card.id || row.nativeId),
      videoId: String(card.videoId || row.nativeId),
      categoryId: String(card.categoryId || raw.categoryId || 'main'),
      title: String(card.title || row.title || ''),
      channelTitle: String(card.channelTitle || row.author || ''),
      description: String(card.description || row.description || ''),
      thumbnailUrl: String(card.thumbnailUrl || ''),
      videoUrl: String(card.videoUrl || row.url || ''),
      publishedAt: toIso(card.publishedAt || row.createdAt),
      viewCount: Number(card.viewCount || row.metrics?.views || 0),
      likeCount:
        typeof card.likeCount === 'number'
          ? Number(card.likeCount)
          : typeof row.metrics?.likes === 'number'
            ? Number(row.metrics.likes)
            : null,
      addedAt: toIso(card.addedAt || row.savedAt),
      updatedAt: toIso(card.updatedAt || row.updatedAt),
    }
  }

  const videoId = String(row.nativeId || '')

  return {
    id: videoId,
    videoId,
    categoryId: String(raw.categoryId || 'main'),
    title: String(row.title || ''),
    channelTitle: String(row.author || ''),
    description: String(row.description || ''),
    thumbnailUrl: '',
    videoUrl: String(row.url || `https://www.youtube.com/watch?v=${videoId}`),
    publishedAt: toIso(row.createdAt),
    viewCount: Number(row.metrics?.views || 0),
    likeCount: typeof row.metrics?.likes === 'number' ? Number(row.metrics.likes) : null,
    addedAt: toIso(row.savedAt),
    updatedAt: toIso(row.updatedAt),
  }
}

const mapItemRowToBookmarkCard = (row) => {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {}

  if (raw.card && typeof raw.card === 'object') {
    const card = raw.card
    const normalizedUrl = String(card.normalizedUrl || row.nativeId || row.url || '')

    return {
      id: String(card.id || normalizedUrl),
      categoryId: String(card.categoryId || raw.categoryId || 'main'),
      url: String(card.url || row.url || normalizedUrl),
      normalizedUrl,
      canonicalUrl: card.canonicalUrl ? String(card.canonicalUrl) : null,
      domain: String(card.domain || row.author || ''),
      title: String(card.title || row.title || normalizedUrl),
      excerpt: String(card.excerpt || row.summary || row.description || ''),
      thumbnailUrl: card.thumbnailUrl ? String(card.thumbnailUrl) : null,
      faviconUrl: card.faviconUrl ? String(card.faviconUrl) : null,
      tags: Array.isArray(card.tags) ? card.tags.map((tag) => String(tag)) : row.tags || [],
      addedAt: toIso(card.addedAt || row.savedAt),
      updatedAt: toIso(card.updatedAt || row.updatedAt),
      metadataStatus: card.metadataStatus === 'ok' ? 'ok' : 'fallback',
      linkStatus:
        card.linkStatus === 'ok' ||
        card.linkStatus === 'redirected' ||
        card.linkStatus === 'blocked' ||
        card.linkStatus === 'not_found' ||
        card.linkStatus === 'timeout' ||
        card.linkStatus === 'error'
          ? card.linkStatus
          : 'unknown',
      lastCheckedAt: card.lastCheckedAt ? toIso(card.lastCheckedAt) : null,
      lastStatusCode:
        typeof card.lastStatusCode === 'number' && Number.isFinite(card.lastStatusCode)
          ? Number(card.lastStatusCode)
          : null,
      lastResolvedUrl: card.lastResolvedUrl ? String(card.lastResolvedUrl) : null,
    }
  }

  const normalizedUrl = String(row.nativeId || row.url || '')
  return {
    id: normalizedUrl,
    categoryId: String(raw.categoryId || 'main'),
    url: String(row.url || normalizedUrl),
    normalizedUrl,
    canonicalUrl: null,
    domain: String(row.author || ''),
    title: String(row.title || row.author || normalizedUrl),
    excerpt: String(row.summary || row.description || '미리보기를 가져오지 못했습니다.'),
    thumbnailUrl: null,
    faviconUrl: null,
    tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
    addedAt: toIso(row.savedAt),
    updatedAt: toIso(row.updatedAt),
    metadataStatus: raw.metadataStatus === 'ok' ? 'ok' : 'fallback',
    linkStatus:
      raw.linkStatus === 'ok' ||
      raw.linkStatus === 'redirected' ||
      raw.linkStatus === 'blocked' ||
      raw.linkStatus === 'not_found' ||
      raw.linkStatus === 'timeout' ||
      raw.linkStatus === 'error'
        ? raw.linkStatus
        : 'unknown',
    lastCheckedAt: raw.lastCheckedAt ? toIso(raw.lastCheckedAt) : null,
    lastStatusCode:
      typeof raw.lastStatusCode === 'number' && Number.isFinite(raw.lastStatusCode)
        ? Number(raw.lastStatusCode)
        : null,
    lastResolvedUrl: raw.lastResolvedUrl ? String(raw.lastResolvedUrl) : null,
  }
}

const loadGithubDashboard = async () => {
  const [itemsResult, notesResult, metaResult] = await Promise.all([
    query(
      `
        SELECT
          id,
          provider,
          type,
          native_id AS "nativeId",
          title,
          summary,
          description,
          url,
          tags,
          author,
          language,
          metrics,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          saved_at AS "savedAt",
          raw
        FROM unified_items
        WHERE provider = 'github'
        ORDER BY COALESCE((raw->>'sortIndex')::int, 2147483647), saved_at DESC
      `,
    ),
    query(
      `
        SELECT id, item_id AS "itemId", content, created_at AS "createdAt"
        FROM unified_notes
        WHERE provider = 'github'
        ORDER BY created_at DESC
      `,
    ),
    query(
      `
        SELECT value
        FROM unified_meta
        WHERE key = $1
      `,
      [DASHBOARD_META_KEY],
    ),
  ])

  const cards = itemsResult.rows.map(mapItemRowToGithubCard)
  const notesByRepo = {}

  for (const note of notesResult.rows) {
    const repoId = String(note.itemId || '').replace(/^github:/, '')

    if (!repoId) {
      continue
    }

    const current = notesByRepo[repoId] || []
    current.push({
      id: String(note.id),
      repoId,
      content: String(note.content),
      createdAt: toIso(note.createdAt),
    })
    notesByRepo[repoId] = current
  }

  const metaValue = metaResult.rowCount ? metaResult.rows[0].value : null
  const categories = normalizeCategories(metaValue?.categories)
  const selectedCategoryId = categories.some((category) => category.id === metaValue?.selectedCategoryId)
    ? metaValue.selectedCategoryId
    : 'main'
  const revision = parseMetaRevision(metaValue)

  return {
    cards,
    notesByRepo,
    categories,
    selectedCategoryId,
    revision,
  }
}

const persistGithubDashboard = async (dashboard, expectedRevision = null) => {
  const normalized = normalizeDashboardPayload(dashboard)
  const items = toGithubUnifiedItems(normalized.cards)
  const itemIds = new Set(items.map((item) => item.id))
  const notes = buildNoteRecordsFromNotesByRepo(normalized.notesByRepo).filter((note) => itemIds.has(note.itemId))

  const client = await getClient()

  try {
    await client.query('BEGIN')

    const revisionResult = await client.query(
      `
        SELECT value
        FROM unified_meta
        WHERE key = $1
        FOR UPDATE
      `,
      [DASHBOARD_META_KEY],
    )
    const currentRevision = revisionResult.rowCount ? parseMetaRevision(revisionResult.rows[0].value) : 0

    if (expectedRevision !== null && expectedRevision !== currentRevision) {
      throw createHttpError(409, '원격 대시보드 버전 충돌이 발생했습니다.')
    }
    const nextRevision = currentRevision + 1

    await client.query('DELETE FROM unified_items WHERE provider = $1', ['github'])

    const insertItemSql = `
      INSERT INTO unified_items (
        id, provider, type, native_id, title, summary, description, url, tags, author, language,
        metrics, status, created_at, updated_at, saved_at, raw
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12::jsonb, $13, $14::timestamptz, $15::timestamptz, $16::timestamptz, $17::jsonb
      )
    `

    for (const item of items) {
      await client.query(insertItemSql, [
        item.id,
        item.provider,
        item.type,
        item.nativeId,
        item.title,
        item.summary,
        item.description,
        item.url,
        item.tags,
        item.author,
        item.language,
        JSON.stringify(item.metrics),
        item.status,
        item.createdAt,
        item.updatedAt,
        item.savedAt,
        JSON.stringify(item.raw),
      ])
    }

    const insertNoteSql = `
      INSERT INTO unified_notes (
        id, provider, item_id, content, created_at
      ) VALUES (
        $1, $2, $3, $4, $5::timestamptz
      )
    `

    for (const note of notes) {
      await client.query(insertNoteSql, [note.id, note.provider, note.itemId, note.content, note.createdAt])
    }

    await client.query(
      `
        INSERT INTO unified_meta (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
      [
        DASHBOARD_META_KEY,
        JSON.stringify({
          categories: normalized.categories,
          selectedCategoryId: normalized.selectedCategoryId,
          revision: nextRevision,
          updatedAt: new Date().toISOString(),
        }),
      ],
    )

    await client.query(
      `
        INSERT INTO unified_meta (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
      ['snapshot:github', JSON.stringify({ items: items.length, notes: notes.length })],
    )

    await client.query('COMMIT')

    return {
      items: items.length,
      notes: notes.length,
      categories: normalized.categories.length,
      revision: nextRevision,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const loadYoutubeDashboard = async () => {
  const [itemsResult, metaResult] = await Promise.all([
    query(
      `
        SELECT
          id,
          provider,
          type,
          native_id AS "nativeId",
          title,
          summary,
          description,
          url,
          tags,
          author,
          language,
          metrics,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          saved_at AS "savedAt",
          raw
        FROM unified_items
        WHERE provider = 'youtube'
        ORDER BY COALESCE((raw->>'sortIndex')::int, 2147483647), saved_at DESC
      `,
    ),
    query(
      `
        SELECT value
        FROM unified_meta
        WHERE key = $1
      `,
      [YOUTUBE_DASHBOARD_META_KEY],
    ),
  ])

  const cards = itemsResult.rows.map(mapItemRowToYoutubeCard)
  const metaValue = metaResult.rowCount ? metaResult.rows[0].value : null
  const categories = normalizeCategories(metaValue?.categories)
  const selectedCategoryId = categories.some((category) => category.id === metaValue?.selectedCategoryId)
    ? metaValue.selectedCategoryId
    : 'main'
  const revision = parseMetaRevision(metaValue)

  return {
    cards,
    categories,
    selectedCategoryId,
    revision,
  }
}

const persistYoutubeDashboard = async (dashboard, expectedRevision = null) => {
  const normalized = normalizeYoutubeDashboardPayload(dashboard)
  const items = toYoutubeUnifiedItems(normalized.cards)

  const client = await getClient()

  try {
    await client.query('BEGIN')

    const revisionResult = await client.query(
      `
        SELECT value
        FROM unified_meta
        WHERE key = $1
        FOR UPDATE
      `,
      [YOUTUBE_DASHBOARD_META_KEY],
    )
    const currentRevision = revisionResult.rowCount ? parseMetaRevision(revisionResult.rows[0].value) : 0

    if (expectedRevision !== null && expectedRevision !== currentRevision) {
      throw createHttpError(409, '원격 대시보드 버전 충돌이 발생했습니다.')
    }
    const nextRevision = currentRevision + 1

    await client.query('DELETE FROM unified_items WHERE provider = $1', ['youtube'])

    const insertItemSql = `
      INSERT INTO unified_items (
        id, provider, type, native_id, title, summary, description, url, tags, author, language,
        metrics, status, created_at, updated_at, saved_at, raw
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12::jsonb, $13, $14::timestamptz, $15::timestamptz, $16::timestamptz, $17::jsonb
      )
    `

    for (const item of items) {
      await client.query(insertItemSql, [
        item.id,
        item.provider,
        item.type,
        item.nativeId,
        item.title,
        item.summary,
        item.description,
        item.url,
        item.tags,
        item.author,
        item.language,
        JSON.stringify(item.metrics),
        item.status,
        item.createdAt,
        item.updatedAt,
        item.savedAt,
        JSON.stringify(item.raw),
      ])
    }

    await client.query(
      `
        INSERT INTO unified_meta (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
      [
        YOUTUBE_DASHBOARD_META_KEY,
        JSON.stringify({
          categories: normalized.categories,
          selectedCategoryId: normalized.selectedCategoryId,
          revision: nextRevision,
          updatedAt: new Date().toISOString(),
        }),
      ],
    )

    await client.query(
      `
        INSERT INTO unified_meta (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
      ['snapshot:youtube', JSON.stringify({ items: items.length, notes: 0 })],
    )

    await client.query('COMMIT')

    return {
      items: items.length,
      categories: normalized.categories.length,
      revision: nextRevision,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const loadBookmarkDashboard = async () => {
  const [itemsResult, metaResult] = await Promise.all([
    query(
      `
        SELECT
          id,
          provider,
          type,
          native_id AS "nativeId",
          title,
          summary,
          description,
          url,
          tags,
          author,
          language,
          metrics,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          saved_at AS "savedAt",
          raw
        FROM unified_items
        WHERE provider = 'bookmark'
        ORDER BY COALESCE((raw->>'sortIndex')::int, 2147483647), saved_at DESC
      `,
    ),
    query(
      `
        SELECT value
        FROM unified_meta
        WHERE key = $1
      `,
      [BOOKMARK_DASHBOARD_META_KEY],
    ),
  ])

  const cards = itemsResult.rows.map(mapItemRowToBookmarkCard)
  const metaValue = metaResult.rowCount ? metaResult.rows[0].value : null
  const categories = normalizeCategories(metaValue?.categories)
  const selectedCategoryId = categories.some((category) => category.id === metaValue?.selectedCategoryId)
    ? metaValue.selectedCategoryId
    : 'main'
  const revision = parseMetaRevision(metaValue)

  return {
    cards,
    categories,
    selectedCategoryId,
    revision,
  }
}

const persistBookmarkDashboard = async (dashboard, expectedRevision = null) => {
  const normalized = normalizeBookmarkDashboardPayload(dashboard)
  const items = toBookmarkUnifiedItems(normalized.cards)

  const client = await getClient()

  try {
    await client.query('BEGIN')

    const revisionResult = await client.query(
      `
        SELECT value
        FROM unified_meta
        WHERE key = $1
        FOR UPDATE
      `,
      [BOOKMARK_DASHBOARD_META_KEY],
    )
    const currentRevision = revisionResult.rowCount ? parseMetaRevision(revisionResult.rows[0].value) : 0

    if (expectedRevision !== null && expectedRevision !== currentRevision) {
      throw createHttpError(409, '원격 대시보드 버전 충돌이 발생했습니다.')
    }
    const nextRevision = currentRevision + 1

    await client.query('DELETE FROM unified_items WHERE provider = $1', ['bookmark'])

    const insertItemSql = `
      INSERT INTO unified_items (
        id, provider, type, native_id, title, summary, description, url, tags, author, language,
        metrics, status, created_at, updated_at, saved_at, raw
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12::jsonb, $13, $14::timestamptz, $15::timestamptz, $16::timestamptz, $17::jsonb
      )
    `

    for (const item of items) {
      await client.query(insertItemSql, [
        item.id,
        item.provider,
        item.type,
        item.nativeId,
        item.title,
        item.summary,
        item.description,
        item.url,
        item.tags,
        item.author,
        item.language,
        JSON.stringify(item.metrics),
        item.status,
        item.createdAt,
        item.updatedAt,
        item.savedAt,
        JSON.stringify(item.raw),
      ])
    }

    await client.query(
      `
        INSERT INTO unified_meta (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
      [
        BOOKMARK_DASHBOARD_META_KEY,
        JSON.stringify({
          categories: normalized.categories,
          selectedCategoryId: normalized.selectedCategoryId,
          revision: nextRevision,
          updatedAt: new Date().toISOString(),
        }),
      ],
    )

    await client.query(
      `
        INSERT INTO unified_meta (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
      ['snapshot:bookmark', JSON.stringify({ items: items.length, notes: 0 })],
    )

    await client.query('COMMIT')

    return {
      items: items.length,
      categories: normalized.categories.length,
      revision: nextRevision,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const fetchWithTimeout = async (url, timeoutMs, init = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

const parseYoutubeErrorMessage = (payload, fallback) => {
  const rawError = payload?.error
  if (!rawError || typeof rawError !== 'object') {
    return fallback
  }

  const directMessage = typeof rawError.message === 'string' ? rawError.message : ''
  if (directMessage) {
    return directMessage
  }

  const firstError = Array.isArray(rawError.errors) ? rawError.errors[0] : null
  return typeof firstError?.message === 'string' && firstError.message ? firstError.message : fallback
}

const TRACKING_QUERY_KEY_SET = new Set(['fbclid', 'gclid'])
const BLOCKED_HOSTNAME_SET = new Set(['localhost'])
const BLOCKED_IPV6_SET = new Set(['::1'])

const decodeHtmlEntities = (value) => {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

const collapseText = (value) => decodeHtmlEntities(String(value || '').replace(/\s+/g, ' ').trim())

const stripTags = (value) => collapseText(String(value || '').replace(/<[^>]*>/g, ' '))

const truncateText = (value, maxLength) => {
  const text = collapseText(value)
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength - 3)}...`
}

const removeTrackingParams = (url) => {
  const keys = Array.from(url.searchParams.keys())
  keys.forEach((key) => {
    const lower = key.toLowerCase()
    if (lower.startsWith('utm_') || TRACKING_QUERY_KEY_SET.has(lower)) {
      url.searchParams.delete(key)
    }
  })
}

const sortQueryParams = (url) => {
  if (!url.search || url.search.length <= 1) {
    return
  }

  const params = new URLSearchParams(url.search)
  params.sort()
  const sorted = params.toString()
  url.search = sorted ? `?${sorted}` : ''
}

const normalizeBookmarkUrl = (input) => {
  const raw = String(input || '').trim()
  if (!raw) {
    return null
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return null
  }

  let candidate = raw
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`
  }

  let url
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }

  if (url.username || url.password) {
    return null
  }

  url.hostname = url.hostname.toLowerCase()
  url.hash = ''
  removeTrackingParams(url)
  sortQueryParams(url)

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '')
    if (!url.pathname) {
      url.pathname = '/'
    }
  }

  const normalizedUrl = url.toString().replace(/\?$/, '')
  const domain = url.hostname.replace(/^www\./, '')

  return {
    normalizedUrl,
    domain,
  }
}

const isPrivateIPv4 = (address) => {
  const [a, b] = String(address || '').split('.').map((value) => Number(value))
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false
  }

  if (a === 10 || a === 127 || a === 0) {
    return true
  }

  if (a === 192 && b === 168) {
    return true
  }

  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }

  if (a === 169 && b === 254) {
    return true
  }

  return false
}

const isPrivateIPv6 = (address) => {
  const lower = String(address || '').toLowerCase()
  if (!lower) {
    return false
  }

  if (BLOCKED_IPV6_SET.has(lower)) {
    return true
  }

  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return true
  }

  if (lower.startsWith('fe80:')) {
    return true
  }

  return false
}

const isPrivateIp = (address) => {
  const version = isIP(address)
  if (version === 4) {
    return isPrivateIPv4(address)
  }
  if (version === 6) {
    return isPrivateIPv6(address)
  }
  return false
}

const assertBookmarkUrlSafe = async (targetUrl) => {
  const url = new URL(targetUrl)
  const hostname = url.hostname.toLowerCase()

  if (BLOCKED_HOSTNAME_SET.has(hostname)) {
    const error = new Error('보안 정책상 접근할 수 없는 주소입니다.')
    error.status = 422
    throw error
  }

  if (isPrivateIp(hostname)) {
    const error = new Error('사설 네트워크 주소는 허용되지 않습니다.')
    error.status = 422
    throw error
  }

  try {
    const lookups = await dns.lookup(hostname, { all: true })
    if (lookups.some((entry) => isPrivateIp(entry.address))) {
      const error = new Error('사설 네트워크로 해석되는 주소는 허용되지 않습니다.')
      error.status = 422
      throw error
    }
  } catch (lookupError) {
    if (lookupError?.status) {
      throw lookupError
    }
    // DNS lookup failure is handled by fetch phase
  }
}

const parseAttributeMap = (tag) => {
  const attributes = {}
  const pattern = /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  let match

  while ((match = pattern.exec(tag)) !== null) {
    const key = String(match[1] || '').toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (key) {
      attributes[key] = value
    }
  }

  return attributes
}

const extractMetaContent = (html, ...keys) => {
  const targets = keys.map((key) => key.toLowerCase())
  const metaPattern = /<meta\b[^>]*>/gi
  let match

  while ((match = metaPattern.exec(html)) !== null) {
    const attrs = parseAttributeMap(match[0])
    const name = String(attrs.property || attrs.name || '').toLowerCase()
    if (!name || !targets.includes(name)) {
      continue
    }

    const content = collapseText(attrs.content || '')
    if (content) {
      return content
    }
  }

  return null
}

const extractTitle = (html) => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return titleMatch ? collapseText(stripTags(titleMatch[1])) : null
}

const extractCanonicalUrl = (html, baseUrl) => {
  const canonicalMatch = html.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i)
  if (!canonicalMatch) {
    return null
  }

  const attrs = parseAttributeMap(canonicalMatch[0])
  if (!attrs.href) {
    return null
  }

  try {
    return new URL(attrs.href, baseUrl).toString()
  } catch {
    return null
  }
}

const extractFirstParagraph = (html) => {
  const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
  let match

  while ((match = paragraphPattern.exec(html)) !== null) {
    const text = stripTags(match[1])
    if (text.length >= 20) {
      return text
    }
  }

  return null
}

const readResponseTextWithLimit = async (response, maxBytes) => {
  const contentLengthHeader = response.headers.get('content-length')
  const parsedContentLength = contentLengthHeader ? Number(contentLengthHeader) : null
  const hasKnownContentLength =
    typeof parsedContentLength === 'number' && Number.isFinite(parsedContentLength) && parsedContentLength >= 0

  if (contentLengthHeader) {
    if (hasKnownContentLength && parsedContentLength > maxBytes) {
      return { text: '', exceeded: true }
    }
  }

  if (!response.body) {
    if (!hasKnownContentLength || parsedContentLength > maxBytes) {
      return { text: '', exceeded: true }
    }

    const text = await response.text()
    const byteLength = Buffer.byteLength(text, 'utf8')
    return {
      text: byteLength > maxBytes ? '' : text,
      exceeded: byteLength > maxBytes,
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || [])
    totalBytes += chunk.byteLength

    if (totalBytes > maxBytes) {
      await reader.cancel()
      return { text: '', exceeded: true }
    }

    chunks.push(decoder.decode(chunk, { stream: true }))
  }

  chunks.push(decoder.decode())
  return {
    text: chunks.join(''),
    exceeded: false,
  }
}

const fetchBookmarkHtmlWithRedirect = async (targetUrl) => {
  const userAgent = 'useful-git-info-bookmark-bot/1.0 (+https://github.com/coreline-ai/collection_useful_github)'
  let currentUrl = targetUrl

  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    await assertBookmarkUrlSafe(currentUrl)

    const response = await fetchWithTimeout(currentUrl, bookmarkFetchTimeoutMs, {
      redirect: 'manual',
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === 3) {
        const error = new Error('리디렉션 횟수 제한을 초과했습니다.')
        error.status = 422
        throw error
      }

      const location = response.headers.get('location')
      if (!location) {
        const error = new Error('잘못된 리디렉션 응답입니다.')
        error.status = 422
        throw error
      }

      currentUrl = new URL(location, currentUrl).toString()
      continue
    }

    return { response, finalUrl: currentUrl }
  }

  const error = new Error('북마크 메타데이터를 불러오지 못했습니다.')
  error.status = 422
  throw error
}

const classifyBookmarkLinkStatus = (statusCode, redirected) => {
  if (statusCode >= 200 && statusCode < 300) {
    return redirected ? 'redirected' : 'ok'
  }

  if (statusCode === 404) {
    return 'not_found'
  }

  if (statusCode === 401 || statusCode === 403) {
    return 'blocked'
  }

  return 'error'
}

const checkBookmarkLinkWithRedirect = async (targetUrl) => {
  const userAgent = 'useful-git-info-bookmark-bot/1.0 (+https://github.com/coreline-ai/collection_useful_github)'
  let currentUrl = targetUrl
  let redirectCount = 0

  for (; redirectCount <= 3; redirectCount += 1) {
    await assertBookmarkUrlSafe(currentUrl)

    let response
    try {
      response = await fetchWithTimeout(currentUrl, bookmarkFetchTimeoutMs, {
        redirect: 'manual',
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return {
          status: 'timeout',
          statusCode: null,
          resolvedUrl: normalizeBookmarkUrl(currentUrl)?.normalizedUrl || currentUrl,
        }
      }

      return {
        status: 'error',
        statusCode: null,
        resolvedUrl: normalizeBookmarkUrl(currentUrl)?.normalizedUrl || currentUrl,
      }
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === 3) {
        return {
          status: 'error',
          statusCode: response.status,
          resolvedUrl: normalizeBookmarkUrl(currentUrl)?.normalizedUrl || currentUrl,
        }
      }

      const location = response.headers.get('location')
      if (!location) {
        return {
          status: 'error',
          statusCode: response.status,
          resolvedUrl: normalizeBookmarkUrl(currentUrl)?.normalizedUrl || currentUrl,
        }
      }

      currentUrl = new URL(location, currentUrl).toString()
      continue
    }

    return {
      status: classifyBookmarkLinkStatus(response.status, redirectCount > 0),
      statusCode: response.status,
      resolvedUrl: normalizeBookmarkUrl(currentUrl)?.normalizedUrl || currentUrl,
    }
  }

  return {
    status: 'error',
    statusCode: null,
    resolvedUrl: normalizeBookmarkUrl(currentUrl)?.normalizedUrl || currentUrl,
  }
}

const buildBookmarkFallbackMetadata = (normalizedUrl, domain, updatedAt) => ({
  url: normalizedUrl,
  normalizedUrl,
  canonicalUrl: null,
  domain,
  title: domain || normalizedUrl,
  excerpt: '미리보기를 가져오지 못했습니다.',
  thumbnailUrl: null,
  faviconUrl: `https://${domain}/favicon.ico`,
  tags: [],
  metadataStatus: 'fallback',
  updatedAt,
})

app.get('/api/bookmark/link-check', async (req, res, next) => {
  try {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : ''
    const normalized = normalizeBookmarkUrl(rawUrl)

    if (!normalized) {
      const error = new Error('유효한 URL(http/https)을 입력해 주세요.')
      error.status = 400
      throw error
    }

    const result = await checkBookmarkLinkWithRedirect(normalized.normalizedUrl)

    res.json({
      ok: true,
      result: {
        checkedUrl: normalized.normalizedUrl,
        resolvedUrl: result.resolvedUrl,
        status: result.status,
        statusCode: result.statusCode,
        lastCheckedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/health', async (_req, res, next) => {
  try {
    await query('SELECT 1')
    res.json({ ok: true, now: new Date().toISOString() })
  } catch (error) {
    next(error)
  }
})

app.get('/api/health/deep', async (_req, res, next) => {
  try {
    const client = await getClient()

    try {
      await client.query('BEGIN')
      const key = '__health_probe__'
      const value = { now: new Date().toISOString() }

      await client.query(
        `
          INSERT INTO unified_meta (key, value, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (key)
          DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `,
        [key, JSON.stringify(value)],
      )

      const readBack = await client.query('SELECT value FROM unified_meta WHERE key = $1', [key])
      await client.query('DELETE FROM unified_meta WHERE key = $1', [key])
      await client.query('COMMIT')

      res.json({ ok: true, probe: readBack.rows[0]?.value || null })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    next(error)
  }
})

app.get('/api/youtube/videos/:videoId', async (req, res, next) => {
  try {
    const { videoId } = req.params

    if (!/^[a-zA-Z0-9_-]{6,20}$/.test(String(videoId || ''))) {
      const error = new Error('유효한 YouTube 영상 ID가 아닙니다.')
      error.status = 400
      throw error
    }

    if (!youtubeApiKey) {
      const error = new Error('YOUTUBE_API_KEY가 설정되지 않았습니다.')
      error.status = 503
      throw error
    }

    const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
    apiUrl.searchParams.set('part', 'snippet,statistics')
    apiUrl.searchParams.set('id', videoId)
    apiUrl.searchParams.set('key', youtubeApiKey)

    let response
    try {
      response = await fetchWithTimeout(apiUrl.toString(), youtubeTimeoutMs)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        const timeoutError = new Error('YouTube API 요청 시간이 초과되었습니다.')
        timeoutError.status = 408
        throw timeoutError
      }
      throw error
    }

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      const apiMessage = parseYoutubeErrorMessage(payload, 'YouTube API 요청에 실패했습니다.')
      const lowerMessage = apiMessage.toLowerCase()

      const failure = new Error(
        lowerMessage.includes('quota')
          ? 'YouTube API 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.'
          : `YouTube API 오류: ${apiMessage}`,
      )
      failure.status = response.status === 403 && lowerMessage.includes('quota') ? 403 : response.status
      throw failure
    }

    const item = Array.isArray(payload.items) ? payload.items[0] : null
    if (!item) {
      const notFound = new Error('영상을 찾을 수 없습니다. URL을 확인해 주세요.')
      notFound.status = 404
      throw notFound
    }

    const snippet = item.snippet || {}
    const statistics = item.statistics || {}
    const thumbnails = snippet.thumbnails || {}
    const thumbnailUrl =
      thumbnails.maxres?.url ||
      thumbnails.standard?.url ||
      thumbnails.high?.url ||
      thumbnails.medium?.url ||
      thumbnails.default?.url ||
      ''

    res.json({
      ok: true,
      video: {
        videoId: String(item.id || videoId),
        title: String(snippet.title || ''),
        channelTitle: String(snippet.channelTitle || ''),
        description: String(snippet.description || ''),
        thumbnailUrl: String(thumbnailUrl),
        publishedAt: toIso(snippet.publishedAt || new Date().toISOString()),
        viewCount: Number(statistics.viewCount || 0),
        likeCount:
          typeof statistics.likeCount === 'string' || typeof statistics.likeCount === 'number'
            ? Number(statistics.likeCount)
            : null,
        url: `https://www.youtube.com/watch?v=${String(item.id || videoId)}`,
        updatedAt: toIso(snippet.publishedAt || new Date().toISOString()),
      },
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/bookmark/metadata', async (req, res, next) => {
  try {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : ''
    const normalized = normalizeBookmarkUrl(rawUrl)

    if (!normalized) {
      const error = new Error('유효한 URL(http/https)을 입력해 주세요.')
      error.status = 400
      throw error
    }

    const updatedAt = new Date().toISOString()

    try {
      const { response, finalUrl } = await fetchBookmarkHtmlWithRedirect(normalized.normalizedUrl)
      if (!response.ok) {
        res.json({
          ok: true,
          metadata: buildBookmarkFallbackMetadata(normalized.normalizedUrl, normalized.domain, updatedAt),
        })
        return
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase()
      if (!contentType.includes('text/html')) {
        res.json({
          ok: true,
          metadata: buildBookmarkFallbackMetadata(normalized.normalizedUrl, normalized.domain, updatedAt),
        })
        return
      }

      const { text: html, exceeded } = await readResponseTextWithLimit(response, bookmarkMaxResponseBytes)
      if (exceeded) {
        res.json({
          ok: true,
          metadata: buildBookmarkFallbackMetadata(normalized.normalizedUrl, normalized.domain, updatedAt),
        })
        return
      }

      const ogTitle = extractMetaContent(html, 'og:title')
      const twitterTitle = extractMetaContent(html, 'twitter:title')
      const pageTitle = extractTitle(html)

      const ogDescription = extractMetaContent(html, 'og:description')
      const metaDescription = extractMetaContent(html, 'description', 'twitter:description')
      const firstParagraph = extractFirstParagraph(html)

      const ogImage = extractMetaContent(html, 'og:image')
      const twitterImage = extractMetaContent(html, 'twitter:image')
      const ogUrl = extractMetaContent(html, 'og:url')
      const canonicalFromLink = extractCanonicalUrl(html, finalUrl)

      const resolvedUrl = normalizeBookmarkUrl(finalUrl)?.normalizedUrl || normalized.normalizedUrl
      const resolvedDomain = new URL(resolvedUrl).hostname.replace(/^www\./, '')

      const hasStructuredTitle = Boolean(ogTitle || twitterTitle)
      const hasStructuredExcerpt = Boolean(ogDescription || metaDescription)
      const hasRichFallbackContent = Boolean(pageTitle && firstParagraph)
      const hasReliableMetadata = hasStructuredTitle || hasStructuredExcerpt || hasRichFallbackContent

      const title = truncateText(ogTitle || twitterTitle || pageTitle || resolvedDomain, 120)
      const excerpt = truncateText(
        ogDescription || metaDescription || firstParagraph || '미리보기를 가져오지 못했습니다.',
        220,
      )

      let thumbnailUrl = null
      const rawImage = ogImage || twitterImage
      if (rawImage) {
        try {
          thumbnailUrl = new URL(rawImage, finalUrl).toString()
        } catch {
          thumbnailUrl = null
        }
      }

      let canonicalUrl = null
      const rawCanonical = ogUrl || canonicalFromLink
      if (rawCanonical) {
        try {
          canonicalUrl = normalizeBookmarkUrl(new URL(rawCanonical, finalUrl).toString())?.normalizedUrl || null
        } catch {
          canonicalUrl = null
        }
      }

      const faviconUrl = `https://${resolvedDomain}/favicon.ico`

      res.json({
        ok: true,
        metadata: {
          url: resolvedUrl,
          normalizedUrl: resolvedUrl,
          canonicalUrl,
          domain: resolvedDomain,
          title: title || resolvedDomain,
          excerpt: excerpt || '미리보기를 가져오지 못했습니다.',
          thumbnailUrl,
          faviconUrl,
          tags: [],
          metadataStatus: hasReliableMetadata ? 'ok' : 'fallback',
          updatedAt,
        },
      })
    } catch (error) {
      if (error?.status === 422) {
        throw error
      }

      res.json({
        ok: true,
        metadata: buildBookmarkFallbackMetadata(normalized.normalizedUrl, normalized.domain, updatedAt),
      })
    }
  } catch (error) {
    next(error)
  }
})

app.get('/api/github/dashboard', async (_req, res, next) => {
  try {
    const dashboard = await loadGithubDashboard()
    res.json({ ok: true, dashboard })
  } catch (error) {
    next(error)
  }
})

app.put('/api/github/dashboard', requireAdminAuth, async (req, res, next) => {
  try {
    const dashboard = normalizeDashboardPayload(req.body?.dashboard)
    const expectedRevision = parseExpectedRevision(req.body?.expectedRevision)
    const result = await persistGithubDashboard(dashboard, expectedRevision)
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

app.get('/api/youtube/dashboard', async (_req, res, next) => {
  try {
    const dashboard = await loadYoutubeDashboard()
    res.json({ ok: true, dashboard })
  } catch (error) {
    next(error)
  }
})

app.put('/api/youtube/dashboard', requireAdminAuth, async (req, res, next) => {
  try {
    const dashboard = normalizeYoutubeDashboardPayload(req.body?.dashboard)
    const expectedRevision = parseExpectedRevision(req.body?.expectedRevision)
    const result = await persistYoutubeDashboard(dashboard, expectedRevision)
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

app.get('/api/bookmark/dashboard', async (_req, res, next) => {
  try {
    const dashboard = await loadBookmarkDashboard()
    res.json({ ok: true, dashboard })
  } catch (error) {
    next(error)
  }
})

app.put('/api/bookmark/dashboard', requireAdminAuth, async (req, res, next) => {
  try {
    const dashboard = normalizeBookmarkDashboardPayload(req.body?.dashboard)
    const expectedRevision = parseExpectedRevision(req.body?.expectedRevision)
    const result = await persistBookmarkDashboard(dashboard, expectedRevision)
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

app.put('/api/providers/:provider/snapshot', requireAdminAuth, async (req, res, next) => {
  const { provider } = req.params

  try {
    ensureProvider(provider)

    if (provider === 'github' && req.body?.dashboard) {
      const dashboard = normalizeDashboardPayload(req.body.dashboard)
      const expectedRevision = parseExpectedRevision(req.body?.expectedRevision)
      const result = await persistGithubDashboard(dashboard, expectedRevision)
      res.json({ ok: true, provider, ...result })
      return
    }

    const rawItems = Array.isArray(req.body?.items) ? req.body.items : []
    const notesByItem =
      typeof req.body?.notesByItem === 'object' && req.body?.notesByItem !== null ? req.body.notesByItem : {}

    const items = rawItems.map((rawItem) => normalizeItem(provider, rawItem))
    const itemIds = new Set(items.map((item) => item.id))
    const notes = flattenNotesByItem(provider, notesByItem).filter((note) => itemIds.has(note.itemId))

    const client = await getClient()

    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM unified_items WHERE provider = $1', [provider])

      const insertItemSql = `
        INSERT INTO unified_items (
          id, provider, type, native_id, title, summary, description, url, tags, author, language,
          metrics, status, created_at, updated_at, saved_at, raw
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12::jsonb, $13, $14::timestamptz, $15::timestamptz, $16::timestamptz, $17::jsonb
        )
      `

      for (const item of items) {
        await client.query(insertItemSql, [
          item.id,
          item.provider,
          item.type,
          item.nativeId,
          item.title,
          item.summary,
          item.description,
          item.url,
          item.tags,
          item.author,
          item.language,
          JSON.stringify(item.metrics),
          item.status,
          item.createdAt,
          item.updatedAt,
          item.savedAt,
          JSON.stringify(item.raw),
        ])
      }

      const insertNoteSql = `
        INSERT INTO unified_notes (
          id, provider, item_id, content, created_at
        ) VALUES (
          $1, $2, $3, $4, $5::timestamptz
        )
      `

      for (const note of notes) {
        await client.query(insertNoteSql, [note.id, note.provider, note.itemId, note.content, note.createdAt])
      }

      await client.query(
        `
          INSERT INTO unified_meta (key, value, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (key)
          DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `,
        [`snapshot:${provider}`, JSON.stringify({ items: items.length, notes: notes.length })],
      )

      await client.query('COMMIT')
      res.json({ ok: true, provider, items: items.length, notes: notes.length })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    next(error)
  }
})

app.get('/api/providers/:provider/items', async (req, res, next) => {
  const { provider } = req.params

  try {
    ensureProvider(provider)

    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500)

    const result = await query(
      `
        SELECT
          id,
          provider,
          type,
          native_id AS "nativeId",
          title,
          summary,
          description,
          url,
          tags,
          author,
          language,
          metrics,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          saved_at AS "savedAt",
          raw
        FROM unified_items
        WHERE provider = $1
        ORDER BY updated_at DESC
        LIMIT $2
      `,
      [provider, limit],
    )

    res.json({ ok: true, items: result.rows })
  } catch (error) {
    next(error)
  }
})

app.get('/api/items/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const itemResult = await query(
      `
        SELECT
          id,
          provider,
          type,
          native_id AS "nativeId",
          title,
          summary,
          description,
          url,
          tags,
          author,
          language,
          metrics,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          saved_at AS "savedAt",
          raw
        FROM unified_items
        WHERE id = $1
      `,
      [id],
    )

    if (itemResult.rowCount === 0) {
      res.status(404).json({ ok: false, message: 'not found' })
      return
    }

    const notesResult = await query(
      `
        SELECT id, item_id AS "itemId", content, created_at AS "createdAt"
        FROM unified_notes
        WHERE item_id = $1
        ORDER BY created_at DESC
      `,
      [id],
    )

    res.json({ ok: true, item: itemResult.rows[0], notes: notesResult.rows })
  } catch (error) {
    next(error)
  }
})

app.get('/api/search', applySearchRateLimit, async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const provider = typeof req.query.provider === 'string' ? req.query.provider.trim() : ''
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : ''
    const modeRaw = typeof req.query.mode === 'string' ? req.query.mode.trim().toLowerCase() : ''
    const mode = modeRaw === 'legacy' ? 'legacy' : modeRaw === '' || modeRaw === 'relevance' ? 'relevance' : null
    const fuzzyEnabled = parseBoolean(typeof req.query.fuzzy === 'string' ? req.query.fuzzy : undefined, true)
    const prefixEnabled = parseBoolean(typeof req.query.prefix === 'string' ? req.query.prefix : undefined, true)
    const minScoreRaw = Number(req.query.min_score || 0)
    const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : 0
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200)

    if (!q) {
      res.json({ ok: true, items: [] })
      return
    }

    if (provider) {
      ensureProvider(provider)
    }

    if (type && !TYPES.has(type)) {
      const error = new Error('invalid type')
      error.status = 400
      throw error
    }

    if (!mode) {
      const error = new Error('invalid mode')
      error.status = 400
      throw error
    }

    if (mode === 'legacy') {
      const result = await query(
        `
          SELECT
            id,
            provider,
            type,
            native_id AS "nativeId",
            title,
            summary,
            description,
            url,
            tags,
            author,
            language,
            metrics,
            status,
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            saved_at AS "savedAt",
            raw
          FROM unified_items
          WHERE ($1::text = '' OR provider = $1)
            AND ($2::text = '' OR type = $2)
            AND (
              title ILIKE '%' || $3 || '%'
              OR summary ILIKE '%' || $3 || '%'
              OR description ILIKE '%' || $3 || '%'
              OR author ILIKE '%' || $3 || '%'
              OR native_id ILIKE '%' || $3 || '%'
              OR array_to_string(tags, ' ') ILIKE '%' || $3 || '%'
            )
          ORDER BY updated_at DESC
          LIMIT $4
        `,
        [provider, type, q, limit],
      )

      res.json({ ok: true, items: result.rows })
      return
    }

    const result = await query(
      `
        WITH search_params AS (
          SELECT
            immutable_unaccent(lower($3::text)) AS normalized_q,
            btrim(regexp_replace(immutable_unaccent(lower($3::text)), '[^[:alnum:][:space:]_]+', ' ', 'g')) AS normalized_q_prefix,
            CASE
              WHEN btrim(regexp_replace(immutable_unaccent(lower($3::text)), '[^[:alnum:][:space:]_]+', ' ', 'g')) = ''
                THEN NULL::tsquery
              ELSE websearch_to_tsquery(
                'simple',
                regexp_replace(immutable_unaccent(lower($3::text)), '[^[:alnum:][:space:]_]+', ' ', 'g')
              )
            END AS fts_query,
            CASE
              WHEN char_length(immutable_unaccent(lower($3::text))) >= 4 THEN 0.1
              WHEN char_length(immutable_unaccent(lower($3::text))) >= 2 THEN 0.16
              ELSE 1.0
            END AS typo_threshold
        ),
        base AS (
          SELECT
            ui.id,
            ui.provider,
            ui.type,
            ui.native_id AS "nativeId",
            ui.title,
            ui.summary,
            ui.description,
            ui.url,
            ui.tags,
            ui.author,
            ui.language,
            ui.metrics,
            ui.status,
            ui.created_at AS "createdAt",
            ui.updated_at AS "updatedAt",
            ui.saved_at AS "savedAt",
            ui.raw,
            ui.updated_at AS updated_at_raw,
            immutable_unaccent(lower(COALESCE(ui.title, ''))) AS normalized_title,
            immutable_unaccent(lower(COALESCE(ui.summary, ''))) AS normalized_summary,
            immutable_unaccent(lower(COALESCE(ui.description, ''))) AS normalized_description,
            immutable_unaccent(lower(COALESCE(ui.author, ''))) AS normalized_author,
            immutable_unaccent(lower(COALESCE(ui.native_id, ''))) AS normalized_native_id,
            immutable_unaccent(lower(COALESCE(array_to_string(ui.tags, ' '), ''))) AS normalized_tags,
            btrim(regexp_replace(immutable_unaccent(lower(COALESCE(ui.title, ''))), '[^[:alnum:][:space:]_]+', ' ', 'g')) AS normalized_title_prefix,
            btrim(regexp_replace(immutable_unaccent(lower(COALESCE(ui.author, ''))), '[^[:alnum:][:space:]_]+', ' ', 'g')) AS normalized_author_prefix,
            btrim(regexp_replace(immutable_unaccent(lower(COALESCE(ui.native_id, ''))), '[^[:alnum:][:space:]_]+', ' ', 'g')) AS normalized_native_id_prefix,
            sp.normalized_q,
            sp.normalized_q_prefix,
            sp.fts_query,
            sp.typo_threshold
          FROM unified_items ui
          CROSS JOIN search_params sp
          WHERE ($1::text = '' OR ui.provider = $1)
            AND ($2::text = '' OR ui.type = $2)
        ),
        ranked AS (
          SELECT
            base.*,
            (
              setweight(to_tsvector('simple'::regconfig, base.normalized_title), 'A') ||
              setweight(to_tsvector('simple'::regconfig, base.normalized_native_id), 'A') ||
              setweight(to_tsvector('simple'::regconfig, base.normalized_summary), 'B') ||
              setweight(to_tsvector('simple'::regconfig, base.normalized_author), 'B') ||
              setweight(to_tsvector('simple'::regconfig, base.normalized_description), 'C') ||
              setweight(to_tsvector('simple'::regconfig, base.normalized_tags), 'C')
            ) AS search_vector,
            (
              base.normalized_title = base.normalized_q
              OR base.normalized_native_id = base.normalized_q
              OR base.normalized_author = base.normalized_q
            ) AS exact_hit,
            (
              base.normalized_q_prefix <> ''
              AND (
                base.normalized_title_prefix LIKE base.normalized_q_prefix || '%'
                OR base.normalized_author_prefix LIKE base.normalized_q_prefix || '%'
                OR base.normalized_native_id_prefix LIKE base.normalized_q_prefix || '%'
              )
            ) AS prefix_hit,
            GREATEST(
              similarity(base.normalized_title, base.normalized_q),
              similarity(base.normalized_summary, base.normalized_q),
              similarity(base.normalized_description, base.normalized_q),
              similarity(base.normalized_author, base.normalized_q),
              similarity(base.normalized_native_id, base.normalized_q),
              similarity(base.normalized_tags, base.normalized_q),
              word_similarity(base.normalized_q, base.normalized_title),
              word_similarity(base.normalized_q, base.normalized_summary),
              word_similarity(base.normalized_q, base.normalized_description),
              word_similarity(base.normalized_q, base.normalized_author),
              word_similarity(base.normalized_q, base.normalized_native_id),
              word_similarity(base.normalized_q, base.normalized_tags)
            ) AS trgm_similarity,
            1.0 / (1.0 + (EXTRACT(EPOCH FROM (NOW() - base.updated_at_raw)) / 86400.0)) AS recency_boost
          FROM base
        ),
        scored AS (
          SELECT
            ranked.*,
            (ranked.fts_query IS NOT NULL AND ranked.search_vector @@ ranked.fts_query) AS fts_hit,
            (
              CASE
                WHEN ranked.fts_query IS NULL THEN 0.0
                ELSE ts_rank_cd(ranked.search_vector, ranked.fts_query)
              END
            ) AS fts_rank,
            (
              char_length(ranked.normalized_q) >= 2
              AND ranked.trgm_similarity >= ranked.typo_threshold
            ) AS trgm_hit
          FROM ranked
        )
        SELECT
          id,
          provider,
          type,
          "nativeId",
          title,
          summary,
          description,
          url,
          tags,
          author,
          language,
          metrics,
          status,
          "createdAt",
          "updatedAt",
          "savedAt",
          raw,
          (
            (CASE WHEN exact_hit THEN 5.0 ELSE 0.0 END) +
            (CASE WHEN prefix_hit AND $6::boolean THEN 2.5 ELSE 0.0 END) +
            (CASE WHEN fts_hit THEN (fts_rank * 1.8) ELSE 0.0 END) +
            (CASE WHEN trgm_hit AND $7::boolean THEN (trgm_similarity * 1.2) ELSE 0.0 END) +
            (recency_boost * 0.4)
          ) AS score,
          ARRAY_REMOVE(
            ARRAY[
              CASE WHEN exact_hit THEN 'exact' END,
              CASE WHEN prefix_hit AND $6::boolean THEN 'prefix' END,
              CASE WHEN fts_hit THEN 'fts' END,
              CASE WHEN trgm_hit AND $7::boolean THEN 'trgm' END
            ],
            NULL
          ) AS "matchedBy"
        FROM scored
        WHERE (
            exact_hit
            OR fts_hit
            OR (prefix_hit AND $6::boolean)
            OR (trgm_hit AND $7::boolean)
          )
          AND (
            (
              (CASE WHEN exact_hit THEN 5.0 ELSE 0.0 END) +
              (CASE WHEN prefix_hit AND $6::boolean THEN 2.5 ELSE 0.0 END) +
              (CASE WHEN fts_hit THEN (fts_rank * 1.8) ELSE 0.0 END) +
              (CASE WHEN trgm_hit AND $7::boolean THEN (trgm_similarity * 1.2) ELSE 0.0 END) +
              (recency_boost * 0.4)
            ) >= $5::double precision
          )
        ORDER BY score DESC, "updatedAt" DESC
        LIMIT $4
      `,
      [provider, type, q, limit, minScore, prefixEnabled, fuzzyEnabled],
    )

    res.json({ ok: true, items: result.rows })
  } catch (error) {
    next(error)
  }
})

app.get('/api/admin/export', requireAdminAuth, async (_req, res, next) => {
  try {
    const [items, notes, meta] = await Promise.all([
      query(
        `
          SELECT
            id,
            provider,
            type,
            native_id AS "nativeId",
            title,
            summary,
            description,
            url,
            tags,
            author,
            language,
            metrics,
            status,
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            saved_at AS "savedAt",
            raw
          FROM unified_items
          ORDER BY provider, updated_at DESC
        `,
      ),
      query(
        `
          SELECT id, provider, item_id AS "itemId", content, created_at AS "createdAt"
          FROM unified_notes
          ORDER BY provider, created_at DESC
        `,
      ),
      query(
        `
          SELECT key, value
          FROM unified_meta
          ORDER BY key ASC
        `,
      ),
    ])

    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        items: items.rows,
        notes: notes.rows,
        meta: Object.fromEntries(meta.rows.map((row) => [row.key, row.value])),
      },
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/import', requireAdminAuth, async (req, res, next) => {
  try {
    const payload = req.body

    if (!payload || payload.version !== 1 || !payload.data) {
      const error = new Error('invalid backup payload')
      error.status = 400
      throw error
    }

    const items = Array.isArray(payload.data.items) ? payload.data.items : []
    const notes = Array.isArray(payload.data.notes) ? payload.data.notes : []
    const meta = payload.data.meta && typeof payload.data.meta === 'object' ? payload.data.meta : {}

    const client = await getClient()

    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM unified_notes')
      await client.query('DELETE FROM unified_items')
      await client.query('DELETE FROM unified_meta')

      const insertItemSql = `
        INSERT INTO unified_items (
          id, provider, type, native_id, title, summary, description, url, tags, author, language,
          metrics, status, created_at, updated_at, saved_at, raw
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12::jsonb, $13, $14::timestamptz, $15::timestamptz, $16::timestamptz, $17::jsonb
        )
      `

      for (const rawItem of items) {
        const item = normalizeItem(rawItem.provider || 'github', rawItem)
        await client.query(insertItemSql, [
          item.id,
          item.provider,
          item.type,
          item.nativeId,
          item.title,
          item.summary,
          item.description,
          item.url,
          item.tags,
          item.author,
          item.language,
          JSON.stringify(item.metrics),
          item.status,
          item.createdAt,
          item.updatedAt,
          item.savedAt,
          JSON.stringify(item.raw),
        ])
      }

      const insertNoteSql = `
        INSERT INTO unified_notes (
          id, provider, item_id, content, created_at
        ) VALUES (
          $1, $2, $3, $4, $5::timestamptz
        )
      `

      for (const note of notes) {
        await client.query(insertNoteSql, [
          String(note.id || `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
          PROVIDERS.has(note.provider) ? note.provider : 'github',
          String(note.itemId || ''),
          String(note.content || ''),
          toIso(note.createdAt || new Date().toISOString()),
        ])
      }

      for (const [key, value] of Object.entries(meta)) {
        await client.query(
          `
            INSERT INTO unified_meta (key, value, updated_at)
            VALUES ($1, $2::jsonb, NOW())
          `,
          [key, JSON.stringify(value)],
        )
      }

      await client.query('COMMIT')

      res.json({ ok: true, items: items.length, notes: notes.length, meta: Object.keys(meta).length })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    next(error)
  }
})

app.use((error, _req, res, _next) => {
  const status = typeof error?.status === 'number' ? error.status : 500
  const message = error instanceof Error ? error.message : 'internal error'
  console.error('[api error]', message)
  res.status(status).json({ ok: false, message })
})

const start = async () => {
  await migrate()

  const port = Number(process.env.PORT || 4000)
  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`)
  })
}

start().catch((error) => {
  console.error('[server] failed to start', error)
  process.exit(1)
})
