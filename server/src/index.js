import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { getClient, query } from './db.js'
import { migrate } from './migrate.js'

dotenv.config()

const PROVIDERS = new Set(['github', 'youtube', 'bookmark'])
const TYPES = new Set(['repository', 'video', 'bookmark'])
const DASHBOARD_META_KEY = 'github_dashboard_v1'
const YOUTUBE_DASHBOARD_META_KEY = 'youtube_dashboard_v1'
const youtubeApiKey = (process.env.YOUTUBE_API_KEY || '').trim()
const youtubeTimeoutSeconds = Number(process.env.YOUTUBE_API_TIMEOUT_SECONDS || 12)
const youtubeTimeoutMs = Number.isFinite(youtubeTimeoutSeconds) && youtubeTimeoutSeconds > 0
  ? Math.floor(youtubeTimeoutSeconds * 1000)
  : 12000

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

  return {
    cards,
    notesByRepo,
    categories,
    selectedCategoryId,
  }
}

const persistGithubDashboard = async (dashboard) => {
  const normalized = normalizeDashboardPayload(dashboard)
  const items = toGithubUnifiedItems(normalized.cards)
  const itemIds = new Set(items.map((item) => item.id))
  const notes = buildNoteRecordsFromNotesByRepo(normalized.notesByRepo).filter((note) => itemIds.has(note.itemId))

  const client = await getClient()

  try {
    await client.query('BEGIN')

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

  return {
    cards,
    categories,
    selectedCategoryId,
  }
}

const persistYoutubeDashboard = async (dashboard) => {
  const normalized = normalizeYoutubeDashboardPayload(dashboard)
  const items = toYoutubeUnifiedItems(normalized.cards)

  const client = await getClient()

  try {
    await client.query('BEGIN')

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
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const fetchWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { signal: controller.signal })
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

app.get('/api/github/dashboard', async (_req, res, next) => {
  try {
    const dashboard = await loadGithubDashboard()
    res.json({ ok: true, dashboard })
  } catch (error) {
    next(error)
  }
})

app.put('/api/github/dashboard', async (req, res, next) => {
  try {
    const dashboard = normalizeDashboardPayload(req.body?.dashboard)
    const result = await persistGithubDashboard(dashboard)
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

app.put('/api/youtube/dashboard', async (req, res, next) => {
  try {
    const dashboard = normalizeYoutubeDashboardPayload(req.body?.dashboard)
    const result = await persistYoutubeDashboard(dashboard)
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

app.put('/api/providers/:provider/snapshot', async (req, res, next) => {
  const { provider } = req.params

  try {
    ensureProvider(provider)

    if (provider === 'github' && req.body?.dashboard) {
      const dashboard = normalizeDashboardPayload(req.body.dashboard)
      const result = await persistGithubDashboard(dashboard)
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

app.get('/api/admin/export', async (_req, res, next) => {
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

app.post('/api/admin/import', async (req, res, next) => {
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
