import compression from 'compression'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import { getClient, query } from './db.js'
import { migrate } from './migrate.js'
import { generateGithubSummaryState, resolveGithubSummaryConfig } from './services/githubSummary.js'
import {
  buildGithubSummaryMetadataHash,
  enqueueGithubSummaryJob,
  getGithubSummaryCache,
  getGithubSummaryCacheTtlMs,
  getGithubSummaryMaxAttempts,
  getGithubSummaryPromptVersion,
  getLatestGithubSummaryJobByRepoId,
  upsertGithubSummaryCache,
} from './services/githubSummaryQueue.js'
import { startGithubSummaryWorker } from './services/githubSummaryWorker.js'
import { generateBookmarkSummaryState, resolveBookmarkSummaryConfig } from './services/bookmarkSummary.js'
import {
  buildBookmarkSummaryMetadataHash,
  enqueueBookmarkSummaryJob,
  getBookmarkSummaryCache,
  getBookmarkSummaryCacheTtlMs,
  getBookmarkSummaryMaxAttempts,
  getBookmarkSummaryPromptVersion,
  getLatestBookmarkSummaryJobByBookmarkId,
  upsertBookmarkSummaryCache,
} from './services/bookmarkSummaryQueue.js'
import { startBookmarkSummaryWorker } from './services/bookmarkSummaryWorker.js'
import { generateYoutubeSummaryState, resolveYoutubeSummaryConfig } from './services/youtubeSummary.js'
import {
  buildYoutubeSummaryMetadataHash,
  enqueueYoutubeSummaryJob,
  getLatestYoutubeSummaryJobByVideoId,
  getYoutubeSummaryCache,
  getYoutubeSummaryCacheTtlMs,
  getYoutubeSummaryMaxAttempts,
  getYoutubeSummaryPromptVersion,
  retryYoutubeSummaryJobById,
  upsertYoutubeSummaryCache,
} from './services/youtubeSummaryQueue.js'
import { startYoutubeSummaryWorker } from './services/youtubeSummaryWorker.js'

dotenv.config()

const PROVIDERS = new Set(['github', 'youtube', 'bookmark'])
const TYPES = new Set(['repository', 'video', 'bookmark'])
const DASHBOARD_META_KEY = 'github_dashboard_v1'
const YOUTUBE_DASHBOARD_META_KEY = 'youtube_dashboard_v1'
const BOOKMARK_DASHBOARD_META_KEY = 'bookmark_dashboard_v1'
const youtubeApiKey = (process.env.YOUTUBE_API_KEY || '').trim()
const githubApiToken = (process.env.GITHUB_API_TOKEN || process.env.GITHUB_TOKEN || '').trim()
const adminApiToken = (process.env.ADMIN_API_TOKEN || '').trim()
const githubApiTimeoutSeconds = Number(process.env.GITHUB_API_TIMEOUT_SECONDS || 12)
const githubApiTimeoutMs = Number.isFinite(githubApiTimeoutSeconds) && githubApiTimeoutSeconds > 0
  ? Math.floor(githubApiTimeoutSeconds * 1000)
  : 12000
const githubSummaryReadmeMaxBytesRaw = Number(process.env.GITHUB_SUMMARY_README_MAX_BYTES || 8192)
const githubSummaryReadmeMaxBytes =
  Number.isFinite(githubSummaryReadmeMaxBytesRaw) && githubSummaryReadmeMaxBytesRaw > 0
    ? Math.floor(githubSummaryReadmeMaxBytesRaw)
    : 8192
const youtubeTimeoutSeconds = Number(process.env.YOUTUBE_API_TIMEOUT_SECONDS || 12)
const youtubeTimeoutMs = Number.isFinite(youtubeTimeoutSeconds) && youtubeTimeoutSeconds > 0
  ? Math.floor(youtubeTimeoutSeconds * 1000)
  : 12000
const bookmarkFetchTimeoutMs = Number(process.env.BOOKMARK_FETCH_TIMEOUT_MS || 10_000)
const bookmarkMaxResponseBytes = Number(process.env.BOOKMARK_MAX_RESPONSE_BYTES || 1_048_576)
const webVitalsEnabled = (process.env.WEB_VITALS_ENABLED || 'false').trim().toLowerCase() === 'true'
const githubSaveMaxDropRatioRaw = Number(process.env.GITHUB_SAVE_MAX_DROP_RATIO || 0.34)
const githubSaveMaxDropRatio =
  Number.isFinite(githubSaveMaxDropRatioRaw) && githubSaveMaxDropRatioRaw >= 0 && githubSaveMaxDropRatioRaw <= 1
    ? githubSaveMaxDropRatioRaw
    : 0.34

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

let youtubeSummaryWorkerRuntime = null
let githubSummaryWorkerRuntime = null
let bookmarkSummaryWorkerRuntime = null

const app = express()
app.use(express.json({ limit: '8mb' }))
app.use(compression({ threshold: 1024 }))

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

const applyApiCacheControl = (req, res, next) => {
  if (req.method !== 'GET' || !req.path.startsWith('/api/')) {
    next()
    return
  }

  if (
    req.path.startsWith('/api/github/dashboard') ||
    req.path.startsWith('/api/github/summaries') ||
    req.path.startsWith('/api/youtube/dashboard') ||
    req.path.startsWith('/api/youtube/summaries') ||
    req.path.startsWith('/api/bookmark/summaries') ||
    req.path.startsWith('/api/bookmark/dashboard') ||
    req.path.startsWith('/api/admin/')
  ) {
    res.set('Cache-Control', 'no-store')
    next()
    return
  }

  if (req.path.startsWith('/api/search')) {
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=15')
    next()
    return
  }

  if (req.path.startsWith('/api/youtube/videos/') || req.path.startsWith('/api/bookmark/metadata')) {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    next()
    return
  }

  res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=30')
  next()
}

app.use(applyApiCacheControl)

const searchRateLimitMap = new Map()
const SEARCH_LIMIT_WINDOW_MS = 60 * 1000
const SEARCH_LIMIT_MAX = 60
const SEARCH_RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let searchRateLimitCleanupCounter = 0

const cleanupSearchRateLimitMap = (now = Date.now()) => {
  for (const [ip, entry] of searchRateLimitMap.entries()) {
    if (now - entry.windowStart >= SEARCH_LIMIT_WINDOW_MS * 2) {
      searchRateLimitMap.delete(ip)
    }
  }
}

setInterval(() => {
  cleanupSearchRateLimitMap()
}, SEARCH_RATE_LIMIT_CLEANUP_INTERVAL_MS).unref?.()
const webVitalsSamples = []
const WEB_VITALS_MAX_SAMPLES = 500

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

const parsePositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw createHttpError(400, 'invalid integer parameter')
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
  if (typeof value === 'boolean') {
    return value
  }

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
  searchRateLimitCleanupCounter += 1
  if (searchRateLimitCleanupCounter >= 200) {
    searchRateLimitCleanupCounter = 0
    cleanupSearchRateLimitMap(now)
  }
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

const resolveYoutubeSummaryStatus = (value, summaryText = '') => {
  if (value === 'queued' || value === 'ready' || value === 'failed') {
    return value
  }

  return String(summaryText || '').trim() ? 'ready' : 'idle'
}

const resolveYoutubeSummaryProvider = (value) => {
  return value === 'glm' ? 'glm' : 'none'
}

const resolveYoutubeNotebookStatus = (value) => {
  if (value === 'queued' || value === 'linked' || value === 'failed') {
    return value
  }

  return 'disabled'
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
    const normalizedSummary = String(card.summary || '').replace(/\s+/g, ' ').trim()
    const normalizedCard = {
      id: String(card.id || '').toLowerCase(),
      categoryId: String(card.categoryId || 'main'),
      owner: String(card.owner || ''),
      repo: String(card.repo || ''),
      fullName: String(card.fullName || ''),
      description: String(card.description || ''),
      summary: normalizedSummary,
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
      summaryStatus:
        card.summaryStatus === 'queued' ||
        card.summaryStatus === 'ready' ||
        card.summaryStatus === 'failed'
          ? card.summaryStatus
          : normalizedSummary
            ? 'ready'
            : 'idle',
      summaryProvider: card.summaryProvider === 'glm' ? 'glm' : 'none',
      summaryUpdatedAt: card.summaryUpdatedAt ? toIso(card.summaryUpdatedAt) : null,
      summaryError: card.summaryError ? String(card.summaryError) : null,
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
    const normalizedSummaryText = typeof card.summaryText === 'string' ? card.summaryText.replace(/\s+/g, ' ').trim() : ''
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
      summaryText: normalizedSummaryText,
      summaryStatus: resolveYoutubeSummaryStatus(card.summaryStatus, normalizedSummaryText),
      summaryUpdatedAt: card.summaryUpdatedAt ? toIso(card.summaryUpdatedAt) : null,
      summaryProvider: resolveYoutubeSummaryProvider(card.summaryProvider),
      summaryError: card.summaryError ? String(card.summaryError) : null,
      notebookSourceStatus: resolveYoutubeNotebookStatus(card.notebookSourceStatus),
      notebookSourceId: card.notebookSourceId ? String(card.notebookSourceId) : null,
      notebookId: card.notebookId ? String(card.notebookId) : null,
      addedAt: toIso(card.addedAt || new Date().toISOString()),
      updatedAt: toIso(card.updatedAt || card.publishedAt || new Date().toISOString()),
    }

    const descriptionSummary = normalizedCard.description
      ? normalizedCard.description.replace(/\s+/g, ' ').trim().slice(0, 180)
      : '영상 설명이 없습니다.'
    const summary = normalizedCard.summaryText || descriptionSummary

    return normalizeItem('youtube', {
      id: `youtube:${videoId}`,
      type: 'video',
      nativeId: videoId,
      title: normalizedCard.title,
      summary:
        summary.length < normalizedCard.description.length && !normalizedCard.summaryText
          ? `${summary.slice(0, 177)}...`
          : summary,
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
      summaryText: typeof card.summaryText === 'string' ? card.summaryText.replace(/\s+/g, ' ').trim() : '',
      summaryStatus: resolveBookmarkSummaryStatus(card.summaryStatus, String(card.summaryText || '').replace(/\s+/g, ' ').trim()),
      summaryProvider: resolveBookmarkSummaryProvider(card.summaryProvider),
      summaryUpdatedAt: card.summaryUpdatedAt ? toIso(card.summaryUpdatedAt) : null,
      summaryError: card.summaryError ? String(card.summaryError) : null,
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
      summary: normalizedCard.summaryText || normalizedCard.excerpt,
      description: normalizedCard.summaryText || normalizedCard.excerpt,
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
        summaryStatus: normalizedCard.summaryStatus,
        summaryProvider: normalizedCard.summaryProvider,
        summaryUpdatedAt: normalizedCard.summaryUpdatedAt,
        summaryError: normalizedCard.summaryError,
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
    const summaryText = typeof card.summary === 'string' ? card.summary : String(row.summary || '')
    const normalizedSummary = summaryText.replace(/\s+/g, ' ').trim()

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
      summaryStatus:
        card.summaryStatus === 'queued' ||
        card.summaryStatus === 'ready' ||
        card.summaryStatus === 'failed'
          ? card.summaryStatus
          : normalizedSummary
            ? 'ready'
            : 'idle',
      summaryProvider: card.summaryProvider === 'glm' ? 'glm' : 'none',
      summaryUpdatedAt: card.summaryUpdatedAt ? toIso(card.summaryUpdatedAt) : null,
      summaryError: card.summaryError ? String(card.summaryError) : null,
    }
  }

  const [owner = '', repo = ''] = String(row.nativeId || '').split('/')
  const summaryText = String(row.summary || '').replace(/\s+/g, ' ').trim()

  return {
    id: String(row.nativeId || '').toLowerCase(),
    categoryId: String(raw.categoryId || 'main'),
    owner,
    repo,
    fullName: String(row.title || row.nativeId || ''),
    description: String(row.description || ''),
    summary: summaryText,
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
    summaryStatus: summaryText ? 'ready' : 'idle',
    summaryProvider: raw.summaryProvider === 'glm' ? 'glm' : 'none',
    summaryUpdatedAt: raw.summaryUpdatedAt ? toIso(raw.summaryUpdatedAt) : null,
    summaryError: raw.summaryError ? String(raw.summaryError) : null,
  }
}

const mapItemRowToYoutubeCard = (row) => {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {}

  if (raw.card && typeof raw.card === 'object') {
    const card = raw.card
    const summaryText = typeof card.summaryText === 'string' ? card.summaryText : String(row.summary || '')

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
      summaryText,
      summaryStatus: resolveYoutubeSummaryStatus(card.summaryStatus, summaryText),
      summaryUpdatedAt: card.summaryUpdatedAt ? toIso(card.summaryUpdatedAt) : null,
      summaryProvider: resolveYoutubeSummaryProvider(card.summaryProvider),
      summaryError: card.summaryError ? String(card.summaryError) : null,
      notebookSourceStatus: resolveYoutubeNotebookStatus(card.notebookSourceStatus),
      notebookSourceId: card.notebookSourceId ? String(card.notebookSourceId) : null,
      notebookId: card.notebookId ? String(card.notebookId) : null,
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
    summaryText: String(row.summary || ''),
    summaryStatus: 'ready',
    summaryUpdatedAt: toIso(row.updatedAt),
    summaryProvider: 'none',
    summaryError: null,
    notebookSourceStatus: 'disabled',
    notebookSourceId: null,
    notebookId: null,
    addedAt: toIso(row.savedAt),
    updatedAt: toIso(row.updatedAt),
  }
}

const mapItemRowToBookmarkCard = (row) => {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {}

  if (raw.card && typeof raw.card === 'object') {
    const card = raw.card
    const normalizedUrl = String(card.normalizedUrl || row.nativeId || row.url || '')
    const excerpt = String(card.excerpt || row.description || row.summary || '')
    const rawSummaryText = typeof card.summaryText === 'string' ? card.summaryText : ''
    const summaryText =
      rawSummaryText.trim() || (row.summary && row.summary !== excerpt ? String(row.summary) : '')

    return {
      id: String(card.id || normalizedUrl),
      categoryId: String(card.categoryId || raw.categoryId || 'main'),
      url: String(card.url || row.url || normalizedUrl),
      normalizedUrl,
      canonicalUrl: card.canonicalUrl ? String(card.canonicalUrl) : null,
      domain: String(card.domain || row.author || ''),
      title: String(card.title || row.title || normalizedUrl),
      excerpt,
      summaryText,
      summaryStatus: resolveBookmarkSummaryStatus(card.summaryStatus, summaryText),
      summaryProvider: resolveBookmarkSummaryProvider(card.summaryProvider),
      summaryUpdatedAt: card.summaryUpdatedAt ? toIso(card.summaryUpdatedAt) : null,
      summaryError: card.summaryError ? String(card.summaryError) : null,
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
  const excerpt = String(row.description || row.summary || '미리보기를 가져오지 못했습니다.')
  const summaryText = row.summary && row.summary !== excerpt ? String(row.summary) : ''
  return {
    id: normalizedUrl,
    categoryId: String(raw.categoryId || 'main'),
    url: String(row.url || normalizedUrl),
    normalizedUrl,
    canonicalUrl: null,
    domain: String(row.author || ''),
    title: String(row.title || row.author || normalizedUrl),
    excerpt,
    summaryText,
    summaryStatus: resolveBookmarkSummaryStatus('ready', summaryText),
    summaryProvider: 'none',
    summaryUpdatedAt: toIso(row.updatedAt),
    summaryError: null,
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

const loadGithubDashboardHistory = async (limit = 30) => {
  const parsedLimit = parsePositiveInt(limit, 30, { min: 1, max: 200 })
  const result = await query(
    `
      SELECT id, revision, event_type AS "eventType", dashboard, created_at AS "createdAt"
      FROM github_dashboard_history
      ORDER BY id DESC
      LIMIT $1
    `,
    [parsedLimit],
  )

  return result.rows.map((row) => ({
    id: Number(row.id),
    revision: Number(row.revision),
    eventType: String(row.eventType),
    createdAt: toIso(row.createdAt),
    dashboard: row.dashboard && typeof row.dashboard === 'object' ? row.dashboard : null,
  }))
}

const rollbackGithubDashboard = async (revision) => {
  const targetRevision = parsePositiveInt(revision, null, { min: 1 })
  if (targetRevision === null) {
    throw createHttpError(400, 'revision is required')
  }

  const historyResult = await query(
    `
      SELECT id, revision, dashboard
      FROM github_dashboard_history
      WHERE revision = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [targetRevision],
  )

  if (historyResult.rowCount === 0) {
    throw createHttpError(404, '요청한 리비전의 GitHub 대시보드 이력을 찾을 수 없습니다.')
  }

  const historyRow = historyResult.rows[0]
  const snapshotDashboard = normalizeDashboardPayload(historyRow.dashboard)
  const revisionResult = await query(
    `
      SELECT value
      FROM unified_meta
      WHERE key = $1
    `,
    [DASHBOARD_META_KEY],
  )
  const expectedRevision = revisionResult.rowCount ? parseMetaRevision(revisionResult.rows[0].value) : 0
  const persisted = await persistGithubDashboard(snapshotDashboard, expectedRevision, 'rollback', {
    allowDestructiveSync: true,
  })

  return {
    ...persisted,
    restoredFromRevision: targetRevision,
    historyId: Number(historyRow.id),
  }
}

const GITHUB_HISTORY_EVENT_TYPES = new Set(['save', 'rollback', 'import', 'restore'])
const GITHUB_DESTRUCTIVE_EVENT_TYPES = new Set(['rollback', 'import', 'restore'])

const parseGithubHistoryEventType = (value, fallback = 'save') => {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (!GITHUB_HISTORY_EVENT_TYPES.has(normalized)) {
    throw createHttpError(400, 'invalid github history eventType')
  }

  return normalized
}

const ensureGithubDestructivePolicy = (allowDestructiveSync, eventType) => {
  if (!allowDestructiveSync) {
    return
  }

  if (!GITHUB_DESTRUCTIVE_EVENT_TYPES.has(eventType)) {
    throw createHttpError(
      400,
      'allowDestructiveSync=true 는 eventType이 rollback/import/restore 인 경우에만 허용됩니다.',
    )
  }
}

const persistGithubDashboard = async (
  dashboard,
  expectedRevision = null,
  eventType = 'save',
  { allowDestructiveSync = false } = {},
) => {
  const normalized = normalizeDashboardPayload(dashboard)
  const items = toGithubUnifiedItems(normalized.cards)
  const itemIds = new Set(items.map((item) => item.id))
  const notes = buildNoteRecordsFromNotesByRepo(normalized.notesByRepo).filter((note) => itemIds.has(note.itemId))

  const normalizedEventType = parseGithubHistoryEventType(eventType, 'save')
  ensureGithubDestructivePolicy(allowDestructiveSync, normalizedEventType)

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

    if (revisionResult.rowCount > 0 && expectedRevision === null) {
      throw createHttpError(409, '원격 대시보드 버전 정보가 없어 저장을 중단했습니다. 새로고침 후 다시 시도해 주세요.')
    }

    if (expectedRevision !== null && expectedRevision !== currentRevision) {
      throw createHttpError(409, '원격 대시보드 버전 충돌이 발생했습니다.')
    }
    const nextRevision = currentRevision + 1
    const currentCountResult = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM unified_items
        WHERE provider = 'github'
      `,
    )
    const currentIdsResult = await client.query(
      `
        SELECT LOWER(native_id) AS native_id
        FROM unified_items
        WHERE provider = 'github'
      `,
    )
    const currentCount = Number(currentCountResult.rows[0]?.count || 0)
    const nextCount = items.length
    const currentNativeIds = new Set(currentIdsResult.rows.map((row) => String(row.native_id || '').trim()).filter(Boolean))
    const nextNativeIds = new Set(items.map((item) => String(item.nativeId || '').toLowerCase().trim()).filter(Boolean))
    let overlapCount = 0
    for (const nativeId of nextNativeIds) {
      if (currentNativeIds.has(nativeId)) {
        overlapCount += 1
      }
    }
    const overlapBase = Math.min(currentNativeIds.size, nextNativeIds.size)
    const overlapRatio = overlapBase > 0 ? overlapCount / overlapBase : 1
    const dropCount = Math.max(currentCount - nextCount, 0)
    const dropRatio = currentCount > 0 ? dropCount / currentCount : 0
    const hasSignificantDrop =
      currentCount >= 6 &&
      nextCount < currentCount &&
      (dropRatio >= githubSaveMaxDropRatio || nextCount === 0)
    const hasSuspiciousReplacement =
      normalizedEventType === 'save' &&
      currentCount >= 6 &&
      nextCount >= 6 &&
      overlapRatio < 0.5

    if (!allowDestructiveSync && hasSignificantDrop) {
      throw createHttpError(
        409,
        `GitHub 대시보드 보호 정책으로 저장이 차단되었습니다. 현재 ${currentCount}개에서 ${nextCount}개로 급감합니다.`,
      )
    }

    if (!allowDestructiveSync && hasSuspiciousReplacement) {
      throw createHttpError(
        409,
        `GitHub 대시보드 보호 정책으로 저장이 차단되었습니다. 기존 데이터와 겹침률이 낮습니다(${Math.round(
          overlapRatio * 100,
        )}%).`,
      )
    }

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

    await client.query(
      `
        INSERT INTO github_dashboard_history (revision, event_type, dashboard, created_at)
        VALUES ($1, $2, $3::jsonb, NOW())
      `,
      [
        nextRevision,
        normalizedEventType,
        JSON.stringify({
          cards: normalized.cards,
          notesByRepo: normalized.notesByRepo,
          categories: normalized.categories,
          selectedCategoryId: normalized.selectedCategoryId,
        }),
      ],
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

    if (revisionResult.rowCount > 0 && expectedRevision === null) {
      throw createHttpError(409, '원격 대시보드 버전 정보가 없어 저장을 중단했습니다. 새로고침 후 다시 시도해 주세요.')
    }

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

    if (revisionResult.rowCount > 0 && expectedRevision === null) {
      throw createHttpError(409, '원격 대시보드 버전 정보가 없어 저장을 중단했습니다. 새로고침 후 다시 시도해 주세요.')
    }

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

const resolveGithubSummaryStatus = (value, summaryText = '') => {
  if (value === 'queued' || value === 'ready' || value === 'failed') {
    return value
  }

  return String(summaryText || '').trim() ? 'ready' : 'idle'
}

const resolveGithubSummaryProvider = (value) => {
  return value === 'glm' ? 'glm' : 'none'
}

const resolveBookmarkSummaryStatus = (value, summaryText = '') => {
  if (value === 'queued' || value === 'ready' || value === 'failed') {
    return value
  }

  return String(summaryText || '').trim() ? 'ready' : 'idle'
}

const resolveBookmarkSummaryProvider = (value) => {
  return value === 'glm' ? 'glm' : 'none'
}

const parseGithubRepoId = (repoId) => {
  const normalized = String(repoId || '').trim().toLowerCase()
  const match = normalized.match(/^([a-z0-9_.-]+)\/([a-z0-9_.-]+)$/i)
  if (!match) {
    return null
  }

  return {
    repoId: `${match[1]}/${match[2]}`.toLowerCase(),
    owner: match[1],
    repo: match[2],
  }
}

const createGithubApiHeaders = () => {
  const headers = {
    Accept: 'application/vnd.github+json',
  }

  if (githubApiToken) {
    headers.Authorization = `Bearer ${githubApiToken}`
  }

  return headers
}

const parseGithubApiErrorMessage = async (response) => {
  const payload = await response.json().catch(() => ({}))
  const remoteMessage = String(payload?.message || '')
  const lower = remoteMessage.toLowerCase()

  if (response.status === 404) {
    return '저장소를 찾을 수 없습니다. URL의 owner/repo 경로를 확인해 주세요.'
  }

  if (response.status === 403) {
    if (lower.includes('rate limit')) {
      return 'GitHub API 요청 제한에 도달했습니다. GITHUB_API_TOKEN 설정을 권장합니다.'
    }
    return '이 저장소 정보에 접근할 수 없습니다.'
  }

  return remoteMessage ? `GitHub API 오류: ${remoteMessage}` : `GitHub API 요청 실패 (${response.status})`
}

const trimTextByBytes = (value, maxBytes) => {
  const text = String(value || '')
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text
  }

  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const chunk = text.slice(0, mid)
    if (Buffer.byteLength(chunk, 'utf8') <= maxBytes) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return text.slice(0, low)
}

const fetchGithubRepoMetadata = async (repoId) => {
  const parsed = parseGithubRepoId(repoId)
  if (!parsed) {
    const error = new Error('유효한 GitHub 저장소 ID(owner/repo)가 아닙니다.')
    error.status = 400
    throw error
  }

  let response
  try {
    response = await fetchWithTimeout(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
      githubApiTimeoutMs,
      {
        headers: createGithubApiHeaders(),
      },
    )
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const timeoutError = new Error('GitHub API 요청 시간이 초과되었습니다.')
      timeoutError.status = 408
      throw timeoutError
    }

    throw error
  }

  if (!response.ok) {
    const failure = new Error(await parseGithubApiErrorMessage(response))
    failure.status = response.status
    throw failure
  }

  const payload = await response.json().catch(() => ({}))

  return {
    repoId: parsed.repoId,
    owner: parsed.owner,
    repo: parsed.repo,
    fullName: String(payload.full_name || parsed.repoId),
    description: String(payload.description || ''),
  }
}

const fetchGithubReadmePreview = async (owner, repo) => {
  let response
  try {
    response = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      githubApiTimeoutMs,
      {
        headers: createGithubApiHeaders(),
      },
    )
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return ''
    }

    throw error
  }

  if (response.status === 404) {
    return ''
  }

  if (!response.ok) {
    const failure = new Error(await parseGithubApiErrorMessage(response))
    failure.status = response.status
    throw failure
  }

  const payload = await response.json().catch(() => ({}))
  if (payload?.encoding !== 'base64' || !payload?.content) {
    return ''
  }

  const decoded = Buffer.from(String(payload.content).replace(/\n/g, ''), 'base64').toString('utf8')
  return trimTextByBytes(decoded, githubSummaryReadmeMaxBytes)
}

const fetchYoutubeVideoMetadata = async (videoId) => {
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

  return {
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
  }
}

const loadGithubItemByRepoId = async (repoId) => {
  const parsed = parseGithubRepoId(repoId)
  if (!parsed) {
    return null
  }

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
      WHERE provider = 'github' AND LOWER(native_id) = LOWER($1)
      LIMIT 1
    `,
    [parsed.repoId],
  )

  if (!result.rowCount) {
    return null
  }

  return mapItemRowToGithubCard(result.rows[0])
}

const buildGithubSummaryColumnValue = (card) => {
  const summaryText = String(card.summary || '').replace(/\s+/g, ' ').trim()
  if (!summaryText) {
    return 'No description available for this repository yet.'
  }

  return summaryText.length <= 220 ? summaryText : `${summaryText.slice(0, 217)}...`
}

const persistGithubSummaryToSnapshot = async (repoId, summaryPayload) => {
  const existing = await loadGithubItemByRepoId(repoId)
  if (!existing) {
    return null
  }

  const now = toIso(new Date())
  const nextSummary =
    typeof summaryPayload.summaryText === 'string' && summaryPayload.summaryText.trim()
      ? summaryPayload.summaryText.trim()
      : existing.summary

  const nextCard = {
    ...existing,
    summary: nextSummary,
    summaryStatus: resolveGithubSummaryStatus(summaryPayload.summaryStatus, nextSummary),
    summaryProvider: resolveGithubSummaryProvider(summaryPayload.summaryProvider),
    summaryUpdatedAt: summaryPayload.summaryUpdatedAt ? toIso(summaryPayload.summaryUpdatedAt) : now,
    summaryError: summaryPayload.summaryError ? String(summaryPayload.summaryError) : null,
    updatedAt: now,
  }

  const summaryColumnValue = buildGithubSummaryColumnValue(nextCard)

  await query(
    `
      UPDATE unified_items
      SET
        summary = $1,
        updated_at = $2::timestamptz,
        raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{card}', $3::jsonb, true)
      WHERE provider = 'github' AND LOWER(native_id) = LOWER($4)
    `,
    [summaryColumnValue, now, JSON.stringify(nextCard), repoId],
  )

  return nextCard
}

const toGithubSummaryResponseFromCache = (cacheEntry, fallbackSummary = '') => {
  const summaryText = String(cacheEntry?.summaryText || fallbackSummary || '').trim()
  const now = new Date().toISOString()
  return {
    summaryText,
    summaryStatus: summaryText ? 'ready' : 'idle',
    summaryUpdatedAt: cacheEntry?.generatedAt ? toIso(cacheEntry.generatedAt) : now,
    summaryProvider: resolveGithubSummaryProvider(cacheEntry?.provider || 'glm'),
    summaryError: null,
  }
}

const toGithubSummaryResponseFromJob = (job, fallbackSummary = '') => {
  const status = String(job?.status || '').toLowerCase()
  if (status === 'queued' || status === 'running') {
    return {
      summaryText: fallbackSummary,
      summaryStatus: 'queued',
      summaryUpdatedAt: null,
      summaryProvider: 'none',
      summaryError: null,
    }
  }

  if (status === 'failed' || status === 'dead') {
    return {
      summaryText: fallbackSummary,
      summaryStatus: 'failed',
      summaryUpdatedAt: job?.updatedAt ? toIso(job.updatedAt) : new Date().toISOString(),
      summaryProvider: 'glm',
      summaryError: job?.errorMessage || '요약 생성에 실패했습니다.',
    }
  }

  const summaryText = job?.resultSummary ? String(job.resultSummary) : fallbackSummary
  return {
    summaryText,
    summaryStatus: summaryText ? 'ready' : 'idle',
    summaryUpdatedAt: job?.updatedAt ? toIso(job.updatedAt) : null,
    summaryProvider: summaryText ? 'glm' : 'none',
    summaryError: null,
  }
}

const processGithubSummaryJob = async (job) => {
  const repoId = String(job?.repoId || job?.payload?.repoId || '').trim().toLowerCase()
  const parsed = parseGithubRepoId(repoId)
  if (!parsed) {
    const error = new Error('요약 작업의 repoId(owner/repo)가 비어 있습니다.')
    error.status = 400
    error.code = 'missing_repo_id'
    throw error
  }

  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {}
  const force = parseBoolean(payload.force, false)
  const cardMetadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}

  const description = String(cardMetadata.description || '')
  const readme = String(cardMetadata.readme || '')

  const [repoMetadata, storedCard] = await Promise.all([
    description
      ? Promise.resolve({
          repoId: parsed.repoId,
          owner: parsed.owner,
          repo: parsed.repo,
          fullName: String(cardMetadata.fullName || parsed.repoId),
          description,
        })
      : fetchGithubRepoMetadata(parsed.repoId),
    loadGithubItemByRepoId(parsed.repoId),
  ])

  const readmePreview = readme || (await fetchGithubReadmePreview(repoMetadata.owner, repoMetadata.repo))

  const config = resolveGithubSummaryConfig(process.env)
  const summaryState = await generateGithubSummaryState({
    metadata: {
      repoId: parsed.repoId,
      fullName: repoMetadata.fullName,
      description: repoMetadata.description,
      readme: readmePreview,
    },
    currentCard: storedCard,
    force,
    config,
  })

  await persistGithubSummaryToSnapshot(parsed.repoId, summaryState)

  if (summaryState.summaryStatus === 'ready' && summaryState.summaryText.trim()) {
    const metadataHash = buildGithubSummaryMetadataHash({
      repoId: parsed.repoId,
      description: repoMetadata.description,
      readme: readmePreview,
    })
    await upsertGithubSummaryCache({
      repoId: parsed.repoId,
      metadataHash,
      promptVersion: getGithubSummaryPromptVersion(),
      provider: summaryState.summaryProvider || 'glm',
      summaryText: summaryState.summaryText,
      ttlMs: getGithubSummaryCacheTtlMs(),
    })

    return {
      ...summaryState,
      resultSummary: summaryState.summaryText,
    }
  }

  const failure = new Error(summaryState.summaryError || '요약 생성에 실패했습니다.')
  failure.code = 'summary_generation_failed'
  failure.retryable = false
  throw failure
}

const loadYoutubeItemByVideoId = async (videoId) => {
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
      WHERE provider = 'youtube' AND native_id = $1
      LIMIT 1
    `,
    [videoId],
  )

  if (!result.rowCount) {
    return null
  }

  return mapItemRowToYoutubeCard(result.rows[0])
}

const buildYoutubeSummaryColumnValue = (card) => {
  const summaryText = String(card.summaryText || '').replace(/\s+/g, ' ').trim()
  if (summaryText) {
    return summaryText.length <= 220 ? summaryText : `${summaryText.slice(0, 217)}...`
  }

  const description = String(card.description || '').replace(/\s+/g, ' ').trim()
  if (!description) {
    return '영상 설명이 없습니다.'
  }

  return description.length <= 180 ? description : `${description.slice(0, 177)}...`
}

const persistYoutubeSummaryToSnapshot = async (videoId, summaryPayload) => {
  const existing = await loadYoutubeItemByVideoId(videoId)
  if (!existing) {
    return null
  }

  const now = toIso(new Date())
  const nextCard = {
    ...existing,
    ...summaryPayload,
    summaryText: String(summaryPayload.summaryText || ''),
    summaryStatus: resolveYoutubeSummaryStatus(summaryPayload.summaryStatus),
    summaryUpdatedAt: summaryPayload.summaryUpdatedAt ? toIso(summaryPayload.summaryUpdatedAt) : now,
    summaryProvider: resolveYoutubeSummaryProvider(summaryPayload.summaryProvider),
    summaryError: summaryPayload.summaryError ? String(summaryPayload.summaryError) : null,
    notebookSourceStatus: resolveYoutubeNotebookStatus(summaryPayload.notebookSourceStatus),
    notebookSourceId: summaryPayload.notebookSourceId ? String(summaryPayload.notebookSourceId) : null,
    notebookId: summaryPayload.notebookId ? String(summaryPayload.notebookId) : null,
    updatedAt: now,
  }

  const summaryColumnValue = buildYoutubeSummaryColumnValue(nextCard)

  await query(
    `
      UPDATE unified_items
      SET
        summary = $1,
        updated_at = $2::timestamptz,
        raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{card}', $3::jsonb, true)
      WHERE provider = 'youtube' AND native_id = $4
    `,
    [summaryColumnValue, now, JSON.stringify(nextCard), videoId],
  )

  return nextCard
}

const toYoutubeSummaryResponseFromCache = (cacheEntry) => {
  const now = new Date().toISOString()
  return {
    summaryText: String(cacheEntry?.summaryText || ''),
    summaryStatus: 'ready',
    summaryUpdatedAt: cacheEntry?.generatedAt ? toIso(cacheEntry.generatedAt) : now,
    summaryProvider: resolveYoutubeSummaryProvider(cacheEntry?.provider || 'glm'),
    summaryError: null,
    notebookSourceStatus: cacheEntry?.notebookSourceId ? 'linked' : 'disabled',
    notebookSourceId: cacheEntry?.notebookSourceId || null,
    notebookId: cacheEntry?.notebookId || null,
  }
}

const toYoutubeSummaryResponseFromJob = (job) => {
  const status = String(job?.status || '').toLowerCase()
  if (status === 'queued' || status === 'running') {
    return {
      summaryText: '',
      summaryStatus: 'queued',
      summaryUpdatedAt: null,
      summaryProvider: 'none',
      summaryError: null,
      notebookSourceStatus: 'disabled',
      notebookSourceId: null,
      notebookId: null,
    }
  }

  if (status === 'failed' || status === 'dead') {
    return {
      summaryText: '',
      summaryStatus: 'failed',
      summaryUpdatedAt: job?.updatedAt ? toIso(job.updatedAt) : new Date().toISOString(),
      summaryProvider: 'none',
      summaryError: job?.errorMessage || '요약 생성에 실패했습니다.',
      notebookSourceStatus: 'disabled',
      notebookSourceId: null,
      notebookId: null,
    }
  }

  return {
    summaryText: job?.resultSummary ? String(job.resultSummary) : '',
    summaryStatus: job?.resultSummary ? 'ready' : 'idle',
    summaryUpdatedAt: job?.updatedAt ? toIso(job.updatedAt) : null,
    summaryProvider: job?.resultSummary ? 'glm' : 'none',
    summaryError: null,
    notebookSourceStatus: 'disabled',
    notebookSourceId: null,
    notebookId: null,
  }
}

const processYoutubeSummaryJob = async (job) => {
  const videoId = String(job?.videoId || job?.payload?.videoId || '').trim()
  if (!videoId) {
    const error = new Error('요약 작업의 videoId가 비어 있습니다.')
    error.status = 400
    error.code = 'missing_video_id'
    throw error
  }

  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {}
  const force = parseBoolean(payload.force, false)

  const [videoMetadata, storedCard] = await Promise.all([
    fetchYoutubeVideoMetadata(videoId),
    loadYoutubeItemByVideoId(videoId),
  ])

  const config = resolveYoutubeSummaryConfig(process.env)
  const summaryState = await generateYoutubeSummaryState({
    videoId,
    metadata: videoMetadata,
    currentCard: storedCard,
    force,
    config,
  })

  await persistYoutubeSummaryToSnapshot(videoId, summaryState)

  if (summaryState.summaryStatus === 'ready' && summaryState.summaryText.trim()) {
    const metadataHash = buildYoutubeSummaryMetadataHash(videoMetadata)
    await upsertYoutubeSummaryCache({
      videoId,
      metadataHash,
      promptVersion: getYoutubeSummaryPromptVersion(),
      provider: summaryState.summaryProvider || 'glm',
      summaryText: summaryState.summaryText,
      notebookSourceId: summaryState.notebookSourceId || null,
      notebookId: summaryState.notebookId || null,
      ttlMs: getYoutubeSummaryCacheTtlMs(),
    })

    return {
      ...summaryState,
      resultSummary: summaryState.summaryText,
    }
  }

  const failure = new Error(summaryState.summaryError || '요약 생성에 실패했습니다.')
  failure.code = 'summary_generation_failed'
  failure.retryable = false
  throw failure
}

const loadBookmarkItemByBookmarkId = async (bookmarkId) => {
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
      WHERE provider = 'bookmark' AND native_id = $1
      LIMIT 1
    `,
    [bookmarkId],
  )

  if (!result.rowCount) {
    return null
  }

  return mapItemRowToBookmarkCard(result.rows[0])
}

const buildBookmarkSummaryColumnValue = (card) => {
  const summaryText = String(card.summaryText || '').replace(/\s+/g, ' ').trim()
  if (summaryText) {
    return summaryText.length <= 220 ? summaryText : `${summaryText.slice(0, 217)}...`
  }

  const excerpt = String(card.excerpt || '').replace(/\s+/g, ' ').trim()
  if (!excerpt) {
    return '요약 정보가 없습니다.'
  }

  return excerpt.length <= 220 ? excerpt : `${excerpt.slice(0, 217)}...`
}

const persistBookmarkSummaryToSnapshot = async (bookmarkId, summaryPayload) => {
  const existing = await loadBookmarkItemByBookmarkId(bookmarkId)
  if (!existing) {
    return null
  }

  const now = toIso(new Date())
  const nextSummaryText =
    typeof summaryPayload.summaryText === 'string' && summaryPayload.summaryText.trim()
      ? summaryPayload.summaryText.trim()
      : existing.summaryText

  const nextCard = {
    ...existing,
    summaryText: nextSummaryText,
    summaryStatus: resolveBookmarkSummaryStatus(summaryPayload.summaryStatus, nextSummaryText),
    summaryProvider: resolveBookmarkSummaryProvider(summaryPayload.summaryProvider),
    summaryUpdatedAt: summaryPayload.summaryUpdatedAt ? toIso(summaryPayload.summaryUpdatedAt) : now,
    summaryError: summaryPayload.summaryError ? String(summaryPayload.summaryError) : null,
    updatedAt: now,
  }

  const summaryColumnValue = buildBookmarkSummaryColumnValue(nextCard)

  await query(
    `
      UPDATE unified_items
      SET
        summary = $1,
        updated_at = $2::timestamptz,
        raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{card}', $3::jsonb, true)
      WHERE provider = 'bookmark' AND native_id = $4
    `,
    [summaryColumnValue, now, JSON.stringify(nextCard), bookmarkId],
  )

  return nextCard
}

const toBookmarkSummaryResponseFromCache = (cacheEntry) => {
  const now = new Date().toISOString()
  return {
    summaryText: String(cacheEntry?.summaryText || ''),
    summaryStatus: 'ready',
    summaryUpdatedAt: cacheEntry?.generatedAt ? toIso(cacheEntry.generatedAt) : now,
    summaryProvider: resolveBookmarkSummaryProvider(cacheEntry?.provider || 'glm'),
    summaryError: null,
  }
}

const toBookmarkSummaryResponseFromJob = (job, fallbackSummary = '') => {
  const status = String(job?.status || '').toLowerCase()
  if (status === 'queued' || status === 'running') {
    return {
      summaryText: fallbackSummary,
      summaryStatus: 'queued',
      summaryUpdatedAt: null,
      summaryProvider: 'none',
      summaryError: null,
    }
  }

  if (status === 'failed' || status === 'dead') {
    return {
      summaryText: fallbackSummary,
      summaryStatus: 'failed',
      summaryUpdatedAt: job?.updatedAt ? toIso(job.updatedAt) : new Date().toISOString(),
      summaryProvider: 'glm',
      summaryError: job?.errorMessage || '요약 생성에 실패했습니다.',
    }
  }

  const summaryText = job?.resultSummary ? String(job.resultSummary) : fallbackSummary
  return {
    summaryText,
    summaryStatus: summaryText ? 'ready' : 'idle',
    summaryUpdatedAt: job?.updatedAt ? toIso(job.updatedAt) : null,
    summaryProvider: summaryText ? 'glm' : 'none',
    summaryError: null,
  }
}

const processBookmarkSummaryJob = async (job) => {
  const bookmarkId = String(job?.bookmarkId || job?.payload?.bookmarkId || '').trim()
  if (!bookmarkId) {
    const error = new Error('요약 작업의 bookmarkId가 비어 있습니다.')
    error.status = 400
    error.code = 'missing_bookmark_id'
    throw error
  }

  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {}
  const force = parseBoolean(payload.force, false)
  const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : null

  const normalized = normalizeBookmarkUrl(bookmarkId)
  if (!normalized) {
    const error = new Error('유효한 bookmarkId가 아닙니다.')
    error.status = 400
    error.code = 'invalid_bookmark_id'
    throw error
  }

  const storedCard = await loadBookmarkItemByBookmarkId(normalized.normalizedUrl)
  if (!storedCard) {
    const error = new Error('대시보드에 등록된 북마크 카드가 아닙니다.')
    error.status = 404
    error.code = 'bookmark_not_found'
    throw error
  }

  const summaryState = await generateBookmarkSummaryState({
    metadata: metadata || {
      bookmarkId: normalized.normalizedUrl,
      normalizedUrl: normalized.normalizedUrl,
      title: storedCard.title,
      excerpt: storedCard.excerpt,
      domain: storedCard.domain,
    },
    currentCard: storedCard,
    force,
    config: resolveBookmarkSummaryConfig(process.env),
  })

  await persistBookmarkSummaryToSnapshot(normalized.normalizedUrl, summaryState)

  if (summaryState.summaryStatus === 'ready' && summaryState.summaryText.trim()) {
    const metadataHash = buildBookmarkSummaryMetadataHash(
      metadata || {
        bookmarkId: normalized.normalizedUrl,
        normalizedUrl: normalized.normalizedUrl,
        title: storedCard.title,
        excerpt: storedCard.excerpt,
        domain: storedCard.domain,
      },
    )

    await upsertBookmarkSummaryCache({
      bookmarkId: normalized.normalizedUrl,
      metadataHash,
      promptVersion: getBookmarkSummaryPromptVersion(),
      provider: summaryState.summaryProvider || 'glm',
      summaryText: summaryState.summaryText,
      ttlMs: getBookmarkSummaryCacheTtlMs(),
    })

    return {
      ...summaryState,
      resultSummary: summaryState.summaryText,
    }
  }

  const failure = new Error(summaryState.summaryError || '요약 생성에 실패했습니다.')
  failure.code = 'summary_generation_failed'
  failure.retryable = false
  throw failure
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

app.post('/api/github/summaries/regenerate', requireAdminAuth, async (req, res, next) => {
  try {
    const repoIdRaw = typeof req.body?.repoId === 'string' ? req.body.repoId : ''
    const parsed = parseGithubRepoId(repoIdRaw)
    const force = parseBoolean(req.body?.force, false)

    if (!parsed) {
      const error = new Error('유효한 GitHub 저장소 ID(owner/repo)가 아닙니다.')
      error.status = 400
      throw error
    }

    const [repoMetadata, storedCard] = await Promise.all([
      fetchGithubRepoMetadata(parsed.repoId),
      loadGithubItemByRepoId(parsed.repoId),
    ])

    if (!storedCard) {
      const error = new Error('대시보드에 등록된 GitHub 카드가 아닙니다.')
      error.status = 404
      throw error
    }

    const readme = await fetchGithubReadmePreview(repoMetadata.owner, repoMetadata.repo)
    const metadataHash = buildGithubSummaryMetadataHash({
      repoId: parsed.repoId,
      description: repoMetadata.description,
      readme,
    })
    const promptVersion = getGithubSummaryPromptVersion()
    const summaryProvider = resolveGithubSummaryConfig(process.env).summaryProvider || 'glm'

    if (!force) {
      const cacheEntry = await getGithubSummaryCache({
        repoId: parsed.repoId,
        metadataHash,
        promptVersion,
        provider: summaryProvider,
      })

      if (cacheEntry) {
        const summaryState = toGithubSummaryResponseFromCache(cacheEntry, storedCard.summary)
        await persistGithubSummaryToSnapshot(parsed.repoId, summaryState)
        res.json({
          ok: true,
          cached: true,
          summaryJobStatus: 'succeeded',
          ...summaryState,
        })
        return
      }
    }

    const job = await enqueueGithubSummaryJob({
      repoId: parsed.repoId,
      metadataHash,
      promptVersion,
      force,
      maxAttempts: getGithubSummaryMaxAttempts(),
      payload: {
        repoId: parsed.repoId,
        force,
        metadata: {
          repoId: parsed.repoId,
          fullName: repoMetadata.fullName,
          description: repoMetadata.description,
          readme,
        },
        requestedAt: new Date().toISOString(),
      },
    })

    if (githubSummaryWorkerRuntime?.trigger) {
      githubSummaryWorkerRuntime.trigger()
    }

    if (storedCard.summaryStatus === 'ready' && storedCard.summary && !force) {
      res.json({
        ok: true,
        jobId: job.id,
        summaryJobStatus: job.status,
        summaryText: storedCard.summary,
        summaryStatus: 'ready',
        summaryUpdatedAt: storedCard.summaryUpdatedAt || storedCard.updatedAt || new Date().toISOString(),
        summaryProvider: storedCard.summaryProvider || 'glm',
        summaryError: null,
      })
      return
    }

    res.json({
      ok: true,
      jobId: job.id,
      summaryJobStatus: job.status,
      summaryText: storedCard.summary || '',
      summaryStatus: 'queued',
      summaryUpdatedAt: null,
      summaryProvider: 'none',
      summaryError: null,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/github/summaries/status', async (req, res, next) => {
  try {
    const repoIdRaw = typeof req.query?.repoId === 'string' ? req.query.repoId : ''
    const parsed = parseGithubRepoId(repoIdRaw)
    if (!parsed) {
      const error = new Error('유효한 GitHub 저장소 ID(owner/repo)가 아닙니다.')
      error.status = 400
      throw error
    }

    const [storedCard, job] = await Promise.all([
      loadGithubItemByRepoId(parsed.repoId),
      getLatestGithubSummaryJobByRepoId(parsed.repoId),
    ])

    if (!storedCard) {
      const error = new Error('대시보드에 등록된 GitHub 카드가 아닙니다.')
      error.status = 404
      throw error
    }

    if (job && (job.status === 'queued' || job.status === 'running')) {
      res.json({
        ok: true,
        jobId: job.id,
        summaryJobStatus: job.status,
        ...toGithubSummaryResponseFromJob(job, storedCard.summary || ''),
      })
      return
    }

    if (storedCard.summaryStatus === 'ready' && storedCard.summary) {
      res.json({
        ok: true,
        jobId: job?.id || null,
        summaryJobStatus: job?.status || 'succeeded',
        summaryText: storedCard.summary,
        summaryStatus: 'ready',
        summaryUpdatedAt: storedCard.summaryUpdatedAt || storedCard.updatedAt || new Date().toISOString(),
        summaryProvider: storedCard.summaryProvider || 'glm',
        summaryError: null,
      })
      return
    }

    if (job) {
      res.json({
        ok: true,
        jobId: job.id,
        summaryJobStatus: job.status,
        ...toGithubSummaryResponseFromJob(job, storedCard.summary || ''),
      })
      return
    }

    res.json({
      ok: true,
      jobId: null,
      summaryJobStatus: 'idle',
      summaryText: storedCard.summary || '',
      summaryStatus: storedCard.summaryStatus || 'idle',
      summaryUpdatedAt: storedCard.summaryUpdatedAt || null,
      summaryProvider: storedCard.summaryProvider || 'none',
      summaryError: storedCard.summaryError || null,
    })
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

    const [video, storedCard] = await Promise.all([
      fetchYoutubeVideoMetadata(videoId),
      loadYoutubeItemByVideoId(videoId),
    ])

    res.json({
      ok: true,
      video: {
        ...video,
        summaryText: storedCard?.summaryText || '',
        summaryStatus: storedCard?.summaryStatus || 'idle',
        summaryUpdatedAt: storedCard?.summaryUpdatedAt || null,
        summaryProvider: storedCard?.summaryProvider || 'none',
        summaryError: storedCard?.summaryError || null,
        notebookSourceStatus: storedCard?.notebookSourceStatus || 'disabled',
        notebookSourceId: storedCard?.notebookSourceId || null,
        notebookId: storedCard?.notebookId || null,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/youtube/videos/:videoId/summarize', async (req, res, next) => {
  try {
    const { videoId } = req.params
    const force = parseBoolean(req.body?.force, false)

    if (!/^[a-zA-Z0-9_-]{6,20}$/.test(String(videoId || ''))) {
      const error = new Error('유효한 YouTube 영상 ID가 아닙니다.')
      error.status = 400
      throw error
    }

    const [videoMetadata, storedCard] = await Promise.all([
      fetchYoutubeVideoMetadata(videoId),
      loadYoutubeItemByVideoId(videoId),
    ])
    const metadataHash = buildYoutubeSummaryMetadataHash(videoMetadata)
    const promptVersion = getYoutubeSummaryPromptVersion()
    const summaryProvider = resolveYoutubeSummaryConfig(process.env).summaryProvider || 'glm'

    if (!force) {
      const cacheEntry = await getYoutubeSummaryCache({
        videoId,
        metadataHash,
        promptVersion,
        provider: summaryProvider,
      })

      if (cacheEntry) {
        const summaryState = toYoutubeSummaryResponseFromCache(cacheEntry)
        await persistYoutubeSummaryToSnapshot(videoId, summaryState)
        res.json({
          ok: true,
          cached: true,
          summaryJobStatus: 'succeeded',
          ...summaryState,
        })
        return
      }
    }

    const job = await enqueueYoutubeSummaryJob({
      videoId,
      metadataHash,
      promptVersion,
      force,
      maxAttempts: getYoutubeSummaryMaxAttempts(),
      payload: {
        videoId,
        force,
        metadata: videoMetadata,
        requestedAt: new Date().toISOString(),
      },
    })

    if (youtubeSummaryWorkerRuntime?.trigger) {
      youtubeSummaryWorkerRuntime.trigger()
    }

    if (storedCard?.summaryStatus === 'ready' && storedCard?.summaryText && !force) {
      res.json({
        ok: true,
        jobId: job.id,
        summaryJobStatus: job.status,
        summaryText: storedCard.summaryText,
        summaryStatus: 'ready',
        summaryUpdatedAt: storedCard.summaryUpdatedAt || storedCard.updatedAt || new Date().toISOString(),
        summaryProvider: storedCard.summaryProvider || 'glm',
        summaryError: null,
        notebookSourceStatus: storedCard.notebookSourceStatus || 'disabled',
        notebookSourceId: storedCard.notebookSourceId || null,
        notebookId: storedCard.notebookId || null,
      })
      return
    }

    res.json({
      ok: true,
      jobId: job.id,
      summaryJobStatus: job.status,
      summaryText: '',
      summaryStatus: 'queued',
      summaryUpdatedAt: null,
      summaryProvider: 'none',
      summaryError: null,
      notebookSourceStatus: 'disabled',
      notebookSourceId: null,
      notebookId: null,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/youtube/summaries/:videoId/status', async (req, res, next) => {
  try {
    const { videoId } = req.params

    if (!/^[a-zA-Z0-9_-]{6,20}$/.test(String(videoId || ''))) {
      const error = new Error('유효한 YouTube 영상 ID가 아닙니다.')
      error.status = 400
      throw error
    }

    const [storedCard, job] = await Promise.all([
      loadYoutubeItemByVideoId(videoId),
      getLatestYoutubeSummaryJobByVideoId(videoId),
    ])

    if (storedCard?.summaryStatus === 'ready' && storedCard?.summaryText) {
      res.json({
        ok: true,
        jobId: job?.id || null,
        summaryJobStatus: job?.status || 'succeeded',
        summaryText: storedCard.summaryText,
        summaryStatus: 'ready',
        summaryUpdatedAt: storedCard.summaryUpdatedAt || storedCard.updatedAt || new Date().toISOString(),
        summaryProvider: storedCard.summaryProvider || 'glm',
        summaryError: null,
        notebookSourceStatus: storedCard.notebookSourceStatus || 'disabled',
        notebookSourceId: storedCard.notebookSourceId || null,
        notebookId: storedCard.notebookId || null,
      })
      return
    }

    if (job) {
      res.json({
        ok: true,
        jobId: job.id,
        summaryJobStatus: job.status,
        ...toYoutubeSummaryResponseFromJob(job),
      })
      return
    }

    res.json({
      ok: true,
      jobId: null,
      summaryJobStatus: 'idle',
      summaryText: '',
      summaryStatus: storedCard?.summaryStatus || 'idle',
      summaryUpdatedAt: storedCard?.summaryUpdatedAt || null,
      summaryProvider: storedCard?.summaryProvider || 'none',
      summaryError: storedCard?.summaryError || null,
      notebookSourceStatus: storedCard?.notebookSourceStatus || 'disabled',
      notebookSourceId: storedCard?.notebookSourceId || null,
      notebookId: storedCard?.notebookId || null,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/youtube/summaries/:jobId/retry', async (req, res, next) => {
  try {
    const jobId = parsePositiveInt(req.params?.jobId, null, { min: 1 })
    if (jobId === null) {
      const error = new Error('유효한 jobId가 필요합니다.')
      error.status = 400
      throw error
    }

    const retried = await retryYoutubeSummaryJobById(jobId)
    if (!retried) {
      const error = new Error('재시도 가능한 요약 작업을 찾을 수 없습니다.')
      error.status = 404
      throw error
    }

    if (youtubeSummaryWorkerRuntime?.trigger) {
      youtubeSummaryWorkerRuntime.trigger()
    }

    res.json({
      ok: true,
      job: retried,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/bookmark/summaries/regenerate', requireAdminAuth, async (req, res, next) => {
  try {
    const bookmarkIdRaw = typeof req.body?.bookmarkId === 'string' ? req.body.bookmarkId : ''
    const normalized = normalizeBookmarkUrl(bookmarkIdRaw)
    const force = parseBoolean(req.body?.force, false)

    if (!normalized) {
      const error = new Error('유효한 북마크 URL이 아닙니다.')
      error.status = 400
      throw error
    }

    const storedCard = await loadBookmarkItemByBookmarkId(normalized.normalizedUrl)
    if (!storedCard) {
      const error = new Error('대시보드에 등록된 북마크 카드가 아닙니다.')
      error.status = 404
      throw error
    }

    const metadata = {
      bookmarkId: normalized.normalizedUrl,
      normalizedUrl: normalized.normalizedUrl,
      title: storedCard.title,
      excerpt: storedCard.excerpt,
      domain: storedCard.domain,
    }
    const metadataHash = buildBookmarkSummaryMetadataHash(metadata)
    const promptVersion = getBookmarkSummaryPromptVersion()
    const summaryProvider = resolveBookmarkSummaryConfig(process.env).summaryProvider || 'glm'

    if (!force) {
      const cacheEntry = await getBookmarkSummaryCache({
        bookmarkId: normalized.normalizedUrl,
        metadataHash,
        promptVersion,
        provider: summaryProvider,
      })

      if (cacheEntry) {
        const summaryState = toBookmarkSummaryResponseFromCache(cacheEntry)
        await persistBookmarkSummaryToSnapshot(normalized.normalizedUrl, summaryState)
        res.json({
          ok: true,
          cached: true,
          summaryJobStatus: 'succeeded',
          ...summaryState,
        })
        return
      }
    }

    const job = await enqueueBookmarkSummaryJob({
      bookmarkId: normalized.normalizedUrl,
      metadataHash,
      promptVersion,
      force,
      maxAttempts: getBookmarkSummaryMaxAttempts(),
      payload: {
        bookmarkId: normalized.normalizedUrl,
        force,
        metadata,
        requestedAt: new Date().toISOString(),
      },
    })

    if (bookmarkSummaryWorkerRuntime?.trigger) {
      bookmarkSummaryWorkerRuntime.trigger()
    }

    if (storedCard.summaryStatus === 'ready' && storedCard.summaryText && !force) {
      res.json({
        ok: true,
        jobId: job.id,
        summaryJobStatus: job.status,
        summaryText: storedCard.summaryText,
        summaryStatus: 'ready',
        summaryUpdatedAt: storedCard.summaryUpdatedAt || storedCard.updatedAt || new Date().toISOString(),
        summaryProvider: storedCard.summaryProvider || 'glm',
        summaryError: null,
      })
      return
    }

    res.json({
      ok: true,
      jobId: job.id,
      summaryJobStatus: job.status,
      summaryText: storedCard.summaryText || '',
      summaryStatus: 'queued',
      summaryUpdatedAt: null,
      summaryProvider: 'none',
      summaryError: null,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/bookmark/summaries/status', async (req, res, next) => {
  try {
    const bookmarkIdRaw = typeof req.query?.bookmarkId === 'string' ? req.query.bookmarkId : ''
    const normalized = normalizeBookmarkUrl(bookmarkIdRaw)

    if (!normalized) {
      const error = new Error('유효한 북마크 URL이 아닙니다.')
      error.status = 400
      throw error
    }

    const [storedCard, job] = await Promise.all([
      loadBookmarkItemByBookmarkId(normalized.normalizedUrl),
      getLatestBookmarkSummaryJobByBookmarkId(normalized.normalizedUrl),
    ])

    if (!storedCard) {
      const error = new Error('대시보드에 등록된 북마크 카드가 아닙니다.')
      error.status = 404
      throw error
    }

    if (job && (job.status === 'queued' || job.status === 'running')) {
      res.json({
        ok: true,
        jobId: job.id,
        summaryJobStatus: job.status,
        ...toBookmarkSummaryResponseFromJob(job, storedCard.summaryText || ''),
      })
      return
    }

    if (storedCard.summaryStatus === 'ready' && storedCard.summaryText) {
      res.json({
        ok: true,
        jobId: job?.id || null,
        summaryJobStatus: job?.status || 'succeeded',
        summaryText: storedCard.summaryText,
        summaryStatus: 'ready',
        summaryUpdatedAt: storedCard.summaryUpdatedAt || storedCard.updatedAt || new Date().toISOString(),
        summaryProvider: storedCard.summaryProvider || 'glm',
        summaryError: null,
      })
      return
    }

    if (job) {
      res.json({
        ok: true,
        jobId: job.id,
        summaryJobStatus: job.status,
        ...toBookmarkSummaryResponseFromJob(job, storedCard.summaryText || ''),
      })
      return
    }

    res.json({
      ok: true,
      jobId: null,
      summaryJobStatus: 'idle',
      summaryText: storedCard.summaryText || '',
      summaryStatus: storedCard.summaryStatus || 'idle',
      summaryUpdatedAt: storedCard.summaryUpdatedAt || null,
      summaryProvider: storedCard.summaryProvider || 'none',
      summaryError: storedCard.summaryError || null,
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
    const eventType = parseGithubHistoryEventType(req.body?.eventType, 'save')
    const allowDestructiveSync = parseBoolean(req.body?.allowDestructiveSync, false)
    ensureGithubDestructivePolicy(allowDestructiveSync, eventType)
    const result = await persistGithubDashboard(dashboard, expectedRevision, eventType, {
      allowDestructiveSync,
    })
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

app.get('/api/github/dashboard/history', requireAdminAuth, async (req, res, next) => {
  try {
    const limit = parsePositiveInt(req.query?.limit, 30, { min: 1, max: 200 })
    const history = await loadGithubDashboardHistory(limit)
    res.json({ ok: true, history })
  } catch (error) {
    next(error)
  }
})

app.post('/api/github/dashboard/rollback', requireAdminAuth, async (req, res, next) => {
  try {
    const revision = parsePositiveInt(req.body?.revision, null, { min: 1 })
    const result = await rollbackGithubDashboard(revision)
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
      const eventType = parseGithubHistoryEventType(req.body?.eventType, 'import')
      const allowDestructiveSync = parseBoolean(req.body?.allowDestructiveSync, false)
      ensureGithubDestructivePolicy(allowDestructiveSync, eventType)
      const result = await persistGithubDashboard(dashboard, expectedRevision, eventType, {
        allowDestructiveSync,
      })
      res.json({ ok: true, provider, ...result })
      return
    }

    if (provider === 'github') {
      throw createHttpError(
        409,
        'GitHub 레거시 snapshot 저장은 차단되었습니다. /api/github/dashboard 경로를 사용해 주세요.',
      )
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

app.post('/api/rum/web-vitals', async (req, res, next) => {
  try {
    if (!webVitalsEnabled) {
      res.status(204).end()
      return
    }

    const metric = req.body && typeof req.body === 'object' ? req.body : null
    if (!metric) {
      const error = new Error('invalid metric payload')
      error.status = 400
      throw error
    }

    const name = typeof metric.name === 'string' ? metric.name.trim() : ''
    const value = typeof metric.value === 'number' && Number.isFinite(metric.value) ? metric.value : null
    const rating =
      metric.rating === 'good' || metric.rating === 'needs-improvement' || metric.rating === 'poor'
        ? metric.rating
        : null

    if (!name || value === null || rating === null) {
      const error = new Error('invalid metric payload')
      error.status = 400
      throw error
    }

    const sample = {
      name,
      value,
      rating,
      id: typeof metric.id === 'string' ? metric.id : '',
      navigationType: typeof metric.navigationType === 'string' ? metric.navigationType : '',
      provider: typeof metric.provider === 'string' ? metric.provider : null,
      type: typeof metric.type === 'string' ? metric.type : null,
      page: typeof metric.page === 'string' ? metric.page : null,
      createdAt: new Date().toISOString(),
    }

    webVitalsSamples.push(sample)
    if (webVitalsSamples.length > WEB_VITALS_MAX_SAMPLES) {
      webVitalsSamples.splice(0, webVitalsSamples.length - WEB_VITALS_MAX_SAMPLES)
    }

    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.get('/api/admin/export', requireAdminAuth, async (_req, res, next) => {
  try {
    const [items, notes, meta, githubHistory] = await Promise.all([
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
      query(
        `
          SELECT id, revision, event_type AS "eventType", dashboard, created_at AS "createdAt"
          FROM github_dashboard_history
          ORDER BY id ASC
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
        githubDashboardHistory: githubHistory.rows,
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
    const githubDashboardHistory = Array.isArray(payload.data.githubDashboardHistory)
      ? payload.data.githubDashboardHistory
      : []

    const client = await getClient()

    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM unified_notes')
      await client.query('DELETE FROM unified_items')
      await client.query('DELETE FROM unified_meta')
      await client.query('DELETE FROM github_dashboard_history')

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

      for (const row of githubDashboardHistory) {
        const revision = Number(row?.revision)
        if (!Number.isInteger(revision) || revision < 1) {
          continue
        }

        const eventType = parseGithubHistoryEventType(row?.eventType, 'import')
        const dashboard = row?.dashboard && typeof row.dashboard === 'object' ? row.dashboard : null
        if (!dashboard) {
          continue
        }

        await client.query(
          `
            INSERT INTO github_dashboard_history (revision, event_type, dashboard, created_at)
            VALUES ($1, $2, $3::jsonb, $4::timestamptz)
          `,
          [revision, eventType, JSON.stringify(dashboard), toIso(row?.createdAt || new Date().toISOString())],
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
  const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production'
  if (isProduction && !adminApiToken) {
    throw new Error('ADMIN_API_TOKEN is required when NODE_ENV=production')
  }
  if (!isProduction && !adminApiToken) {
    console.warn('[server] ADMIN_API_TOKEN is empty (dev mode only). Protected routes allow unauthenticated access.')
  }

  await migrate()

  const port = Number(process.env.PORT || 4000)
  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`)
  })

  youtubeSummaryWorkerRuntime = startYoutubeSummaryWorker({
    workerId: `youtube-summary-worker-${process.pid}`,
    processJob: processYoutubeSummaryJob,
    onError: (error, job) => {
      const label = job?.id ? `job=${job.id}` : 'job=none'
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[youtube-summary-worker] ${label} ${message}`)
    },
  })

  githubSummaryWorkerRuntime = startGithubSummaryWorker({
    workerId: `github-summary-worker-${process.pid}`,
    processJob: processGithubSummaryJob,
    onError: (error, job) => {
      const label = job?.id ? `job=${job.id}` : 'job=none'
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[github-summary-worker] ${label} ${message}`)
    },
  })

  bookmarkSummaryWorkerRuntime = startBookmarkSummaryWorker({
    workerId: `bookmark-summary-worker-${process.pid}`,
    processJob: processBookmarkSummaryJob,
    onError: (error, job) => {
      const label = job?.id ? `job=${job.id}` : 'job=none'
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[bookmark-summary-worker] ${label} ${message}`)
    },
  })

  const stopWorker = () => {
    if (youtubeSummaryWorkerRuntime?.stop) {
      youtubeSummaryWorkerRuntime.stop()
    }
    youtubeSummaryWorkerRuntime = null

    if (githubSummaryWorkerRuntime?.stop) {
      githubSummaryWorkerRuntime.stop()
    }
    githubSummaryWorkerRuntime = null

    if (bookmarkSummaryWorkerRuntime?.stop) {
      bookmarkSummaryWorkerRuntime.stop()
    }
    bookmarkSummaryWorkerRuntime = null
  }
  process.once('SIGINT', stopWorker)
  process.once('SIGTERM', stopWorker)
}

start().catch((error) => {
  console.error('[server] failed to start', error)
  process.exit(1)
})
