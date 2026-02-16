import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { getClient, query } from './db.js'
import { migrate } from './migrate.js'

dotenv.config()

const PROVIDERS = new Set(['github', 'youtube', 'bookmark'])
const TYPES = new Set(['repository', 'video', 'bookmark'])
const DASHBOARD_META_KEY = 'github_dashboard_v1'

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
            OR array_to_string(tags, ' ') ILIKE '%' || $3 || '%'
          )
        ORDER BY updated_at DESC
        LIMIT $4
      `,
      [provider, type, q, limit],
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
