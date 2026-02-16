import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const API_BASE =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VITE_POSTGRES_SYNC_API_BASE_URL ?? 'http://localhost:4000'
const shouldRunPostgresE2E =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RUN_POSTGRES_E2E ===
  'true'
const describeIfPostgresE2E = shouldRunPostgresE2E ? describe : describe.skip

const upsertGithubDashboard = async (cards: Array<Record<string, unknown>>) => {
  const currentResponse = await fetch(`${API_BASE}/api/github/dashboard`)
  const currentPayload = (await currentResponse.json()) as { dashboard?: { revision?: number } }
  const expectedRevision =
    typeof currentPayload.dashboard?.revision === 'number' ? currentPayload.dashboard.revision : null

  return fetch(`${API_BASE}/api/github/dashboard`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dashboard: {
        cards,
        notesByRepo: {},
        categories: [
          { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
        ],
        selectedCategoryId: 'main',
      },
      expectedRevision,
      allowDestructiveSync: true,
      eventType: 'restore',
    }),
  })
}

describeIfPostgresE2E('PostgreSQL search ranking E2E', () => {
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

  beforeEach(async () => {
    const githubCards = [
      {
        id: 'facebook/react',
        categoryId: 'main',
        owner: 'facebook',
        repo: 'react',
        fullName: 'facebook/react',
        description: 'A JavaScript library for building user interfaces',
        summary: 'React library for building user interfaces',
        htmlUrl: 'https://github.com/facebook/react',
        homepage: null,
        language: 'TypeScript',
        stars: 1,
        forks: 1,
        watchers: 1,
        openIssues: 1,
        topics: ['react', 'ui'],
        license: 'MIT',
        defaultBranch: 'main',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-16T00:00:00.000Z',
        addedAt: '2026-02-16T00:00:00.000Z',
      },
      {
        id: 'acme/rea-starter',
        categoryId: 'main',
        owner: 'acme',
        repo: 'rea-starter',
        fullName: 'acme/rea-starter',
        description: 'Template project',
        summary: 'Starter template with rea prefix',
        htmlUrl: 'https://github.com/acme/rea-starter',
        homepage: null,
        language: 'TypeScript',
        stars: 1,
        forks: 1,
        watchers: 1,
        openIssues: 1,
        topics: ['starter'],
        license: 'MIT',
        defaultBranch: 'main',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-16T00:00:00.000Z',
        addedAt: '2026-02-16T00:00:00.000Z',
      },
      {
        id: 'acme/legacy-tool',
        categoryId: 'main',
        owner: 'acme',
        repo: 'legacy-tool',
        fullName: 'acme/legacy-tool',
        description: 'No related keywords',
        summary: 'Legacy helper utilities',
        htmlUrl: 'https://github.com/acme/legacy-tool',
        homepage: null,
        language: 'TypeScript',
        stars: 1,
        forks: 1,
        watchers: 1,
        openIssues: 1,
        topics: ['legacy'],
        license: 'MIT',
        defaultBranch: 'main',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-16T00:00:00.000Z',
        addedAt: '2026-02-16T00:00:00.000Z',
      },
    ]

    const [resetGithubResponse, resetYoutubeResponse] = await Promise.all([
      upsertGithubDashboard(githubCards),
      fetch(`${API_BASE}/api/providers/youtube/snapshot`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              id: 'youtube:yt_abcd12345',
              provider: 'youtube',
              type: 'video',
              nativeId: 'yt_abcd12345',
              title: 'AI Agent Workflow Guide',
              summary: 'Short summary for testing',
              description: 'Video description without creator keyword',
              url: 'https://www.youtube.com/watch?v=yt_abcd12345',
              tags: ['workflow'],
              author: 'creator-lab',
              language: null,
              metrics: { views: 100, likes: 10 },
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-02-16T00:00:00.000Z',
              savedAt: '2026-02-16T00:00:00.000Z',
              raw: {},
            },
            {
              id: 'youtube:CgniMVyJtmg',
              provider: 'youtube',
              type: 'video',
              nativeId: 'CgniMVyJtmg',
              title: '[OpenClaw 활용 가이드] AI 알고리즘 기반 주식 자동매매 봇 구축하기',
              summary: 'OpenClaw 활용 가이드 영상',
              description: 'OpenClaw 기반 자동매매 봇 구축 설명 영상',
              url: 'https://www.youtube.com/watch?v=CgniMVyJtmg',
              tags: ['openclaw', 'trading'],
              author: '단테랩스',
              language: null,
              metrics: { views: 2200, likes: 130 },
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-02-16T00:00:00.000Z',
              savedAt: '2026-02-16T00:00:00.000Z',
              raw: {},
            },
          ],
          notesByItem: {},
        }),
      }),
    ])

    if (!resetGithubResponse.ok || !resetYoutubeResponse.ok) {
      throw new Error('Failed to seed search ranking data')
    }
  })

  it('ranks exact > prefix > typo and supports filters/min_score', async () => {
    const exactResponse = await fetch(
      `${API_BASE}/api/search?q=facebook/react&provider=github&type=repository&limit=10&mode=relevance`,
    )
    const exactPayload = (await exactResponse.json()) as {
      ok: boolean
      items: Array<{ id: string; score?: number; matchedBy?: string[] }>
    }
    expect(exactPayload.ok).toBe(true)
    expect(exactPayload.items[0]?.id).toBe('github:facebook/react')
    expect(typeof exactPayload.items[0]?.score).toBe('number')
    expect(Array.isArray(exactPayload.items[0]?.matchedBy)).toBe(true)

    const prefixResponse = await fetch(
      `${API_BASE}/api/search?q=acme/rea&provider=github&type=repository&limit=10&mode=relevance`,
    )
    const prefixPayload = (await prefixResponse.json()) as { ok: boolean; items: Array<{ id: string }> }
    expect(prefixPayload.ok).toBe(true)
    expect(prefixPayload.items[0]?.id).toBe('github:acme/rea-starter')

    const typoResponse = await fetch(
      `${API_BASE}/api/search?q=raect&provider=github&type=repository&limit=10&mode=relevance`,
    )
    const typoPayload = (await typoResponse.json()) as { ok: boolean; items: Array<{ id: string }> }
    expect(typoPayload.ok).toBe(true)
    expect(typoPayload.items.some((item) => item.id === 'github:facebook/react')).toBe(true)

    const typeFilteredResponse = await fetch(
      `${API_BASE}/api/search?q=react&provider=github&type=video&limit=10&mode=relevance`,
    )
    const typeFilteredPayload = (await typeFilteredResponse.json()) as { ok: boolean; items: unknown[] }
    expect(typeFilteredPayload.ok).toBe(true)
    expect(typeFilteredPayload.items).toHaveLength(0)

    const minScoreResponse = await fetch(
      `${API_BASE}/api/search?q=react&provider=github&type=repository&limit=10&mode=relevance&min_score=100`,
    )
    const minScorePayload = (await minScoreResponse.json()) as { ok: boolean; items: unknown[] }
    expect(minScorePayload.ok).toBe(true)
    expect(minScorePayload.items).toHaveLength(0)

    const youtubeAuthorResponse = await fetch(
      `${API_BASE}/api/search?q=creator-lab&provider=youtube&type=video&limit=10&mode=relevance`,
    )
    const youtubeAuthorPayload = (await youtubeAuthorResponse.json()) as {
      ok: boolean
      items: Array<{ id: string }>
    }
    expect(youtubeAuthorPayload.ok).toBe(true)
    expect(youtubeAuthorPayload.items[0]?.id).toBe('youtube:yt_abcd12345')

    const youtubeIdPrefixResponse = await fetch(
      `${API_BASE}/api/search?q=yt_ab&provider=youtube&type=video&limit=10&mode=relevance`,
    )
    const youtubeIdPrefixPayload = (await youtubeIdPrefixResponse.json()) as {
      ok: boolean
      items: Array<{ id: string }>
    }
    expect(youtubeIdPrefixPayload.ok).toBe(true)
    expect(youtubeIdPrefixPayload.items.some((item) => item.id === 'youtube:yt_abcd12345')).toBe(true)

    const youtubeOpenResponse = await fetch(
      `${API_BASE}/api/search?q=open&provider=youtube&type=video&limit=10&mode=relevance`,
    )
    const youtubeOpenPayload = (await youtubeOpenResponse.json()) as {
      ok: boolean
      items: Array<{ id: string }>
    }
    expect(youtubeOpenPayload.ok).toBe(true)
    expect(youtubeOpenPayload.items.some((item) => item.id === 'youtube:CgniMVyJtmg')).toBe(true)
  })
})
