import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkBookmarkLinkStatus,
  fetchBookmarkMetadata,
  fetchBookmarkSummaryStatus,
  isRemoteSnapshotEnabled,
  loadBookmarkDashboardFromRemote,
  loadGithubDashboardFromRemote,
  loadYoutubeDashboardFromRemote,
  regenerateBookmarkSummary,
  saveBookmarkDashboardToRemote,
  saveGithubDashboardToRemote,
  saveYoutubeDashboardToRemote,
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
    expect(await loadYoutubeDashboardFromRemote()).toBeNull()
    expect(await loadBookmarkDashboardFromRemote()).toBeNull()
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

  it('loads youtube dashboard from remote', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        dashboard: {
          cards: [],
          categories: [
            { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
          ],
          selectedCategoryId: 'main',
        },
      }),
    )

    const dashboard = await loadYoutubeDashboardFromRemote()
    expect(dashboard?.selectedCategoryId).toBe('main')
  })

  it('saves youtube dashboard to remote', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(asResponse(200, { ok: true }))

    await saveYoutubeDashboardToRemote({
      cards: [],
      categories: [
        { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      selectedCategoryId: 'main',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/youtube/dashboard')
  })

  it('loads bookmark dashboard from remote', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        dashboard: {
          cards: [],
          categories: [
            { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
          ],
          selectedCategoryId: 'main',
        },
      }),
    )

    const dashboard = await loadBookmarkDashboardFromRemote()
    expect(dashboard?.selectedCategoryId).toBe('main')
  })

  it('saves bookmark dashboard to remote', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(asResponse(200, { ok: true }))

    await saveBookmarkDashboardToRemote({
      cards: [],
      categories: [
        { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      selectedCategoryId: 'main',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/bookmark/dashboard')
  })

  it('fetches bookmark metadata from remote api', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        metadata: {
          url: 'https://example.com/post',
          normalizedUrl: 'https://example.com/post',
          canonicalUrl: null,
          domain: 'example.com',
          title: 'Example',
          excerpt: 'Example excerpt',
          thumbnailUrl: null,
          faviconUrl: 'https://example.com/favicon.ico',
          tags: [],
          metadataStatus: 'ok',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    )

    const metadata = await fetchBookmarkMetadata('https://example.com/post')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/bookmark/metadata?url=')
    expect(metadata.normalizedUrl).toBe('https://example.com/post')
    expect(metadata.metadataStatus).toBe('ok')
  })

  it('checks bookmark link status from remote api', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        result: {
          checkedUrl: 'https://example.com/post',
          resolvedUrl: 'https://example.com/post',
          status: 'ok',
          statusCode: 200,
          lastCheckedAt: '2026-02-16T00:00:00.000Z',
        },
      }),
    )

    const result = await checkBookmarkLinkStatus('https://example.com/post')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/bookmark/link-check?url=')
    expect(result.status).toBe('ok')
    expect(result.statusCode).toBe(200)
  })

  it('requests bookmark summary regeneration', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        jobId: 12,
        summaryJobStatus: 'queued',
        summaryText: '',
        summaryStatus: 'queued',
        summaryUpdatedAt: null,
        summaryProvider: 'none',
        summaryError: null,
      }),
    )

    const result = await regenerateBookmarkSummary('https://example.com/post', { force: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/bookmark/summaries/regenerate')
    expect(result.summaryStatus).toBe('queued')
  })

  it('fetches bookmark summary status', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        jobId: 12,
        summaryJobStatus: 'succeeded',
        summaryText: '요약',
        summaryStatus: 'ready',
        summaryUpdatedAt: '2026-02-17T10:00:00.000Z',
        summaryProvider: 'glm',
        summaryError: null,
      }),
    )

    const result = await fetchBookmarkSummaryStatus('https://example.com/post')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/bookmark/summaries/status?bookmarkId=')
    expect(result.summaryStatus).toBe('ready')
    expect(result.summaryText).toBe('요약')
  })

  it('forwards relevance search options to api query params', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        items: [],
      }),
    )

    await searchUnifiedItems({
      query: 'react',
      provider: 'github',
      type: 'repository',
      limit: 40,
      mode: 'relevance',
      fuzzy: true,
      prefix: true,
      minScore: 0.5,
    })

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0] ?? '')
    expect(requestedUrl).toContain('/api/search?')
    expect(requestedUrl).toContain('q=react')
    expect(requestedUrl).toContain('provider=github')
    expect(requestedUrl).toContain('type=repository')
    expect(requestedUrl).toContain('limit=40')
    expect(requestedUrl).toContain('mode=relevance')
    expect(requestedUrl).toContain('fuzzy=true')
    expect(requestedUrl).toContain('prefix=true')
    expect(requestedUrl).toContain('min_score=0.5')
  })

  it('throws when github dashboard endpoint is missing', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(asResponse(404, { ok: false }))

    await expect(loadGithubDashboardFromRemote()).rejects.toThrow(
      'GitHub 대시보드 API(/api/github/dashboard)를 찾을 수 없습니다.',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws when github dashboard save endpoint is missing', async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(asResponse(404, { ok: false }))

    await expect(
      saveGithubDashboardToRemote({
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
      }),
    ).rejects.toThrow('GitHub 대시보드 API(/api/github/dashboard)를 찾을 수 없습니다.')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
