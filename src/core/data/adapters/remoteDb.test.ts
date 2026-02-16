import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isRemoteSnapshotEnabled,
  loadGithubDashboardFromRemote,
  saveGithubDashboardToRemote,
  searchUnifiedItems,
} from './remoteDb'

const asResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })

describe('remoteDb adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('is disabled without api base url', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', '')

    expect(isRemoteSnapshotEnabled()).toBe(false)
    expect(await loadGithubDashboardFromRemote()).toBeNull()
    expect(await searchUnifiedItems({ query: 'react' })).toEqual([])
  })

  it('loads github dashboard from remote', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        dashboard: {
          cards: [],
          notesByRepo: {},
          categories: [
            { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
          ],
          selectedCategoryId: 'main',
        },
      }),
    )

    const dashboard = await loadGithubDashboardFromRemote()
    expect(dashboard?.selectedCategoryId).toBe('main')
  })

  it('retries save on server error and succeeds', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(asResponse(500, { ok: false, message: 'temporary' }))
      .mockResolvedValueOnce(asResponse(200, { ok: true }))

    await saveGithubDashboardToRemote({
      cards: [],
      notesByRepo: {},
      categories: [
        { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      selectedCategoryId: 'main',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to legacy dashboard load when new endpoint is missing', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(asResponse(404, { ok: false }))
      .mockResolvedValueOnce(
        asResponse(200, {
          ok: true,
          items: [
            {
              id: 'github:facebook/react',
              provider: 'github',
              type: 'repository',
              nativeId: 'facebook/react',
              title: 'facebook/react',
              summary: 'React summary',
              description: 'React desc',
              url: 'https://github.com/facebook/react',
              tags: ['react'],
              author: 'facebook',
              language: 'TypeScript',
              metrics: { stars: 1, forks: 1, watchers: 1 },
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              savedAt: '2026-01-01T00:00:00.000Z',
              raw: {
                card: {
                  id: 'facebook/react',
                  owner: 'facebook',
                  repo: 'react',
                  fullName: 'facebook/react',
                  description: 'React desc',
                  summary: 'React summary',
                  htmlUrl: 'https://github.com/facebook/react',
                  homepage: null,
                  language: 'TypeScript',
                  stars: 1,
                  forks: 1,
                  watchers: 1,
                  openIssues: 1,
                  topics: ['react'],
                  license: 'MIT',
                  defaultBranch: 'main',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                  addedAt: '2026-01-01T00:00:00.000Z',
                  categoryId: 'main',
                },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(asResponse(404, { ok: false }))

    const dashboard = await loadGithubDashboardFromRemote()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(dashboard?.cards).toHaveLength(1)
    expect(dashboard?.cards[0].id).toBe('facebook/react')
  })

  it('falls back to legacy snapshot save when new endpoint is missing', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(asResponse(404, { ok: false }))
      .mockResolvedValueOnce(asResponse(200, { ok: true }))

    await saveGithubDashboardToRemote({
      cards: [
        {
          id: 'facebook/react',
          categoryId: 'main',
          owner: 'facebook',
          repo: 'react',
          fullName: 'facebook/react',
          description: 'React desc',
          summary: 'React summary',
          htmlUrl: 'https://github.com/facebook/react',
          homepage: null,
          language: 'TypeScript',
          stars: 1,
          forks: 1,
          watchers: 1,
          openIssues: 1,
          topics: ['react'],
          license: 'MIT',
          defaultBranch: 'main',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      notesByRepo: {},
      categories: [
        { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      selectedCategoryId: 'main',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/providers/github/snapshot')
  })
})
