import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { YouTubeVideoCard } from '@shared/types'

vi.mock('@features/github/services/github', () => ({
  fetchRepo: vi.fn(),
  fetchRepoDetail: vi.fn(),
  fetchLatestCommitSha: vi.fn(),
}))

vi.mock('@features/youtube/services/youtube', () => ({
  parseYouTubeVideoUrl: vi.fn(),
  fetchYouTubeVideo: vi.fn(),
  buildYouTubeSummary: vi.fn((value: string) => value),
}))

const { fetchRepoDetail, fetchLatestCommitSha } = await import('@features/github/services/github')
const { parseYouTubeVideoUrl, fetchYouTubeVideo } = await import('@features/youtube/services/youtube')

const API_BASE =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VITE_POSTGRES_SYNC_API_BASE_URL ?? 'http://localhost:4000'
const shouldRunPostgresE2E =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.RUN_POSTGRES_E2E === 'true'

const mockYoutubeCard: YouTubeVideoCard = {
  id: 'dQw4w9WgXcQ',
  videoId: 'dQw4w9WgXcQ',
  categoryId: 'main',
  title: 'Never Gonna Give You Up',
  channelTitle: 'Rick Astley',
  description: 'Official music video',
  thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  publishedAt: '2026-02-15T00:00:00.000Z',
  viewCount: 100,
  likeCount: 5,
  addedAt: '2026-02-15T00:00:00.000Z',
  updatedAt: '2026-02-15T00:00:00.000Z',
}

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

const describeIfPostgresE2E = shouldRunPostgresE2E ? describe : describe.skip

describeIfPostgresE2E('PostgreSQL youtube snapshot E2E', () => {
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
    mockMatchMedia(false)

    vi.mocked(fetchRepoDetail).mockResolvedValue({ readmePreview: null, recentActivity: [] })
    vi.mocked(fetchLatestCommitSha).mockResolvedValue(null)
    vi.mocked(parseYouTubeVideoUrl).mockReturnValue({ videoId: 'dQw4w9WgXcQ' })
    vi.mocked(fetchYouTubeVideo).mockResolvedValue(mockYoutubeCard)

    const resetResponse = await fetch(`${API_BASE}/api/providers/youtube/snapshot`, {
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
      throw new Error('Failed to reset youtube provider snapshot before test')
    }
  })

  it('adds a youtube card through UI and persists to PostgreSQL snapshot', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: '유튜브' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '추가' })).toBeEnabled())

    fireEvent.change(screen.getByLabelText('YouTube 영상 URL'), {
      target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await screen.findByText('Never Gonna Give You Up')

    await waitFor(
      async () => {
        const response = await fetch(`${API_BASE}/api/providers/youtube/items?limit=20`)
        const payload = (await response.json()) as {
          ok: boolean
          items: Array<{ id: string; provider: string; nativeId: string; title: string }>
        }

        expect(payload.ok).toBe(true)
        expect(payload.items.some((item) => item.id === 'youtube:dQw4w9WgXcQ')).toBe(true)

        const item = payload.items.find((entry) => entry.id === 'youtube:dQw4w9WgXcQ')
        expect(item?.provider).toBe('youtube')
        expect(item?.nativeId).toBe('dQw4w9WgXcQ')
        expect(item?.title).toBe('Never Gonna Give You Up')
      },
      { timeout: 5000 },
    )
  })
})
