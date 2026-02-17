import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { BookmarkCard } from '@shared/types'

vi.mock('@features/github/services/github', () => ({
  fetchRepo: vi.fn(),
  fetchRepoDetail: vi.fn(),
  fetchLatestCommitSha: vi.fn(),
  regenerateGithubSummary: vi.fn(),
  fetchGithubSummaryStatus: vi.fn(),
}))

vi.mock('@features/youtube/services/youtube', () => ({
  parseYouTubeVideoUrl: vi.fn(),
  fetchYouTubeVideo: vi.fn(),
  summarizeYouTubeVideo: vi.fn(),
  buildYouTubeSummary: vi.fn((value: string) => value),
}))

vi.mock('@features/bookmark/services/bookmark', () => ({
  parseBookmarkUrl: vi.fn(),
  fetchBookmarkMetadata: vi.fn(),
  regenerateBookmarkSummary: vi.fn(),
  fetchBookmarkSummaryStatus: vi.fn(),
  createBookmarkCardFromDraft: vi.fn(
    (
      draft: Omit<
        BookmarkCard,
        | 'categoryId'
        | 'summaryText'
        | 'summaryStatus'
        | 'summaryProvider'
        | 'summaryUpdatedAt'
        | 'summaryError'
        | 'addedAt'
        | 'linkStatus'
        | 'lastCheckedAt'
        | 'lastStatusCode'
        | 'lastResolvedUrl'
      >,
    ) => ({
    ...draft,
    categoryId: 'main',
    summaryText: '',
    summaryStatus: 'idle',
    summaryProvider: 'none',
    summaryUpdatedAt: null,
    summaryError: null,
    addedAt: '2026-02-15T00:00:00.000Z',
    linkStatus: 'unknown',
    lastCheckedAt: null,
    lastStatusCode: null,
    lastResolvedUrl: null,
  }),
  ),
}))

const { parseBookmarkUrl, fetchBookmarkMetadata } = await import('@features/bookmark/services/bookmark')

const API_BASE =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VITE_POSTGRES_SYNC_API_BASE_URL ?? 'http://localhost:4000'
const shouldRunPostgresE2E =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.RUN_POSTGRES_E2E === 'true'

const describeIfPostgresE2E = shouldRunPostgresE2E ? describe : describe.skip

describeIfPostgresE2E('PostgreSQL bookmark snapshot E2E', () => {
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
    vi.clearAllMocks()
    window.localStorage.clear()

    vi.mocked(parseBookmarkUrl).mockReturnValue({
      url: 'https://openai.com/research',
      normalizedUrl: 'https://openai.com/research',
      domain: 'openai.com',
    })
    vi.mocked(fetchBookmarkMetadata).mockResolvedValue({
      id: 'https://openai.com/research',
      url: 'https://openai.com/research',
      normalizedUrl: 'https://openai.com/research',
      canonicalUrl: 'https://openai.com/research',
      domain: 'openai.com',
      title: 'OpenAI Research',
      excerpt: 'OpenAI research updates and papers.',
      thumbnailUrl: null,
      faviconUrl: 'https://openai.com/favicon.ico',
      tags: ['ai'],
      updatedAt: '2026-02-15T00:00:00.000Z',
      metadataStatus: 'ok',
    })

    const resetResponse = await fetch(`${API_BASE}/api/providers/bookmark/snapshot`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [],
        notesByItem: {},
      }),
    })

    if (!resetResponse.ok) {
      throw new Error('Failed to reset bookmark provider snapshot before test')
    }
  })

  it('adds a bookmark card through UI and persists to PostgreSQL snapshot', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: '북마크' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '추가' })).toBeEnabled())

    fireEvent.change(screen.getByLabelText('북마크 URL'), {
      target: { value: 'https://openai.com/research' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await screen.findByText('OpenAI Research')

    await waitFor(
      async () => {
        const response = await fetch(`${API_BASE}/api/providers/bookmark/items?limit=20`)
        const payload = (await response.json()) as {
          ok: boolean
          items: Array<{ id: string; provider: string; nativeId: string; title: string }>
        }

        expect(payload.ok).toBe(true)
        expect(payload.items.some((item) => item.id === 'bookmark:https://openai.com/research')).toBe(true)

        const item = payload.items.find((entry) => entry.id === 'bookmark:https://openai.com/research')
        expect(item?.provider).toBe('bookmark')
        expect(item?.nativeId).toBe('https://openai.com/research')
        expect(item?.title).toBe('OpenAI Research')
      },
      { timeout: 5000 },
    )
  })
})
