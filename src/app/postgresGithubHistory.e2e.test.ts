import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const API_BASE =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VITE_POSTGRES_SYNC_API_BASE_URL ?? 'http://localhost:4000'
const shouldRunPostgresE2E =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RUN_POSTGRES_E2E ===
  'true'
const describeIfPostgresE2E = shouldRunPostgresE2E ? describe : describe.skip

type DashboardPayload = {
  cards: Array<Record<string, unknown>>
  notesByRepo: Record<string, Array<Record<string, unknown>>>
  categories: Array<{ id: string; name: string; isSystem: boolean; createdAt: string }>
  selectedCategoryId: string
}

const SYSTEM_CATEGORIES = [
  { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
]

const nowIso = () => new Date().toISOString()

const makeCard = (fullName: string, categoryId = 'main') => {
  const [owner, repo] = fullName.split('/')
  const ts = nowIso()
  return {
    id: fullName.toLowerCase(),
    owner,
    repo,
    fullName,
    description: `${fullName} description`,
    summary: `${fullName} summary`,
    htmlUrl: `https://github.com/${fullName}`,
    homepage: null,
    language: 'TypeScript',
    stars: 1,
    forks: 1,
    watchers: 1,
    openIssues: 1,
    topics: ['e2e'],
    license: 'MIT',
    defaultBranch: 'main',
    createdAt: ts,
    updatedAt: ts,
    addedAt: ts,
    categoryId,
  }
}

const putDashboard = async (dashboard: DashboardPayload) => {
  const currentResponse = await fetch(`${API_BASE}/api/github/dashboard`)
  const currentPayload = (await currentResponse.json()) as {
    dashboard?: { revision?: number }
  }
  const expectedRevision =
    typeof currentPayload.dashboard?.revision === 'number' ? currentPayload.dashboard.revision : null

  const response = await fetch(`${API_BASE}/api/github/dashboard`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dashboard,
      expectedRevision,
      eventType: 'save',
    }),
  })

  if (!response.ok) {
    throw new Error(`dashboard PUT failed: ${response.status}`)
  }

  return (await response.json()) as { ok: boolean; revision?: number }
}

const putDashboardRaw = async (
  dashboard: DashboardPayload,
  options?: { allowDestructiveSync?: boolean; eventType?: string },
) => {
  const currentResponse = await fetch(`${API_BASE}/api/github/dashboard`)
  const currentPayload = (await currentResponse.json()) as {
    dashboard?: { revision?: number }
  }
  const expectedRevision =
    typeof currentPayload.dashboard?.revision === 'number' ? currentPayload.dashboard.revision : null

  return fetch(`${API_BASE}/api/github/dashboard`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dashboard,
      expectedRevision,
      eventType: options?.eventType ?? 'save',
      allowDestructiveSync: options?.allowDestructiveSync ?? false,
    }),
  })
}

describeIfPostgresE2E('PostgreSQL GitHub dashboard history/rollback E2E', () => {
  beforeAll(async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', API_BASE)

    const health = await fetch(`${API_BASE}/api/health`)
    if (!health.ok) {
      throw new Error('PostgreSQL API server is not healthy')
    }
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('records dashboard revisions and rolls back to a selected revision', async () => {
    const firstDashboard: DashboardPayload = {
      cards: [makeCard('alpha/one')],
      notesByRepo: {},
      categories: SYSTEM_CATEGORIES,
      selectedCategoryId: 'main',
    }

    const firstSaveResponse = await putDashboardRaw(firstDashboard, {
      allowDestructiveSync: true,
      eventType: 'restore',
    })
    expect(firstSaveResponse.ok).toBe(true)
    const firstSave = (await firstSaveResponse.json()) as { ok: boolean; revision?: number }
    expect(firstSave.ok).toBe(true)
    expect(typeof firstSave.revision).toBe('number')

    const secondDashboard: DashboardPayload = {
      cards: [makeCard('beta/two'), makeCard('alpha/one')],
      notesByRepo: {},
      categories: SYSTEM_CATEGORIES,
      selectedCategoryId: 'main',
    }

    const secondSave = await putDashboard(secondDashboard)
    expect(secondSave.ok).toBe(true)
    expect((secondSave.revision ?? 0) > (firstSave.revision ?? 0)).toBe(true)

    const historyResponse = await fetch(`${API_BASE}/api/github/dashboard/history?limit=20`)
    expect(historyResponse.ok).toBe(true)
    const historyPayload = (await historyResponse.json()) as {
      ok: boolean
      history: Array<{ revision: number; eventType: string }>
    }
    expect(historyPayload.ok).toBe(true)
    expect(historyPayload.history.length).toBeGreaterThanOrEqual(2)
    expect(historyPayload.history.some((entry) => entry.revision === firstSave.revision)).toBe(true)

    const rollbackResponse = await fetch(`${API_BASE}/api/github/dashboard/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: firstSave.revision }),
    })
    expect(rollbackResponse.ok).toBe(true)
    const rollbackPayload = (await rollbackResponse.json()) as {
      ok: boolean
      restoredFromRevision: number
      revision: number
    }
    expect(rollbackPayload.ok).toBe(true)
    expect(rollbackPayload.restoredFromRevision).toBe(firstSave.revision)
    expect(rollbackPayload.revision > (secondSave.revision ?? 0)).toBe(true)

    const verifyResponse = await fetch(`${API_BASE}/api/github/dashboard`)
    expect(verifyResponse.ok).toBe(true)
    const verifyPayload = (await verifyResponse.json()) as {
      dashboard: { cards: Array<{ fullName: string }> }
    }
    const fullNames = verifyPayload.dashboard.cards.map((card) => card.fullName)
    expect(fullNames).toEqual(['alpha/one'])
  })

  it('blocks accidental large-card-loss save without explicit destructive override', async () => {
    const largeDashboard: DashboardPayload = {
      cards: [
        makeCard('guard/a1'),
        makeCard('guard/a2'),
        makeCard('guard/a3'),
        makeCard('guard/a4'),
        makeCard('guard/a5'),
        makeCard('guard/a6'),
        makeCard('guard/a7'),
        makeCard('guard/a8'),
      ],
      notesByRepo: {},
      categories: SYSTEM_CATEGORIES,
      selectedCategoryId: 'main',
    }

    const seed = await putDashboard(largeDashboard)
    expect(seed.ok).toBe(true)

    const accidentalShrink: DashboardPayload = {
      cards: [makeCard('guard/a1'), makeCard('guard/a2'), makeCard('guard/a3')],
      notesByRepo: {},
      categories: SYSTEM_CATEGORIES,
      selectedCategoryId: 'main',
    }

    const blocked = await putDashboardRaw(accidentalShrink)
    expect(blocked.status).toBe(409)
    const blockedPayload = (await blocked.json()) as { ok: boolean; message?: string }
    expect(blockedPayload.ok).toBe(false)
    expect(blockedPayload.message || '').toContain('보호 정책')

    const forced = await putDashboardRaw(accidentalShrink, { allowDestructiveSync: true, eventType: 'restore' })
    expect(forced.ok).toBe(true)
  })

  it('blocks low-overlap replacement save without explicit destructive override', async () => {
    const sourceDashboard: DashboardPayload = {
      cards: [
        makeCard('overlap/a1'),
        makeCard('overlap/a2'),
        makeCard('overlap/a3'),
        makeCard('overlap/a4'),
        makeCard('overlap/a5'),
        makeCard('overlap/a6'),
      ],
      notesByRepo: {},
      categories: SYSTEM_CATEGORIES,
      selectedCategoryId: 'main',
    }

    const seed = await putDashboardRaw(sourceDashboard, { allowDestructiveSync: true, eventType: 'restore' })
    expect(seed.ok).toBe(true)

    const lowOverlapDashboard: DashboardPayload = {
      cards: [
        makeCard('overlap/b1'),
        makeCard('overlap/b2'),
        makeCard('overlap/b3'),
        makeCard('overlap/b4'),
        makeCard('overlap/b5'),
        makeCard('overlap/b6'),
      ],
      notesByRepo: {},
      categories: SYSTEM_CATEGORIES,
      selectedCategoryId: 'main',
    }

    const blocked = await putDashboardRaw(lowOverlapDashboard)
    expect(blocked.status).toBe(409)
    const blockedPayload = (await blocked.json()) as { ok: boolean; message?: string }
    expect(blockedPayload.ok).toBe(false)
    expect(blockedPayload.message || '').toContain('겹침률')

    const forced = await putDashboardRaw(lowOverlapDashboard, {
      allowDestructiveSync: true,
      eventType: 'restore',
    })
    expect(forced.ok).toBe(true)
  })

  it('blocks legacy github provider snapshot writes', async () => {
    const response = await fetch(`${API_BASE}/api/providers/github/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [],
        notesByItem: {},
      }),
    })

    expect(response.status).toBe(409)
    const payload = (await response.json()) as { ok: boolean; message?: string }
    expect(payload.ok).toBe(false)
    expect(payload.message || '').toContain('레거시 snapshot 저장은 차단')
  })
})
