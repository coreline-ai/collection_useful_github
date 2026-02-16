import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { GitHubRepoCard } from '@shared/types'

vi.mock('@features/github/services/github', () => ({
  fetchRepo: vi.fn(),
  searchPublicRepos: vi.fn().mockResolvedValue({ items: [], totalCount: 0, page: 1, perPage: 12, hasNextPage: false }),
  fetchRepoDetail: vi.fn(),
  fetchLatestCommitSha: vi.fn(),
}))

const { fetchRepo, fetchRepoDetail, fetchLatestCommitSha } = await import('@features/github/services/github')

const mockCard: GitHubRepoCard = {
  id: 'facebook/react',
  categoryId: 'main',
  owner: 'facebook',
  repo: 'react',
  fullName: 'facebook/react',
  description: 'The library for web and native user interfaces.',
  summary: 'React summary text',
  htmlUrl: 'https://github.com/facebook/react',
  homepage: 'https://react.dev',
  language: 'TypeScript',
  stars: 1,
  forks: 1,
  watchers: 1,
  openIssues: 1,
  topics: ['ui'],
  license: 'MIT',
  defaultBranch: 'main',
  createdAt: '2026-02-15T00:00:00.000Z',
  updatedAt: '2026-02-15T00:00:00.000Z',
  addedAt: '2026-02-15T00:00:00.000Z',
}

const API_BASE =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VITE_POSTGRES_SYNC_API_BASE_URL ?? 'http://localhost:4000'
const shouldRunPostgresE2E =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.RUN_POSTGRES_E2E === 'true'

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

describeIfPostgresE2E('PostgreSQL snapshot E2E', () => {
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

    const resetResponse = await fetch(`${API_BASE}/api/providers/github/snapshot`, {
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
      throw new Error('Failed to reset github provider snapshot before test')
    }
  })

  it('adds a card through UI and persists to PostgreSQL snapshot', async () => {
    vi.mocked(fetchRepo).mockResolvedValue(mockCard)

    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: '추가' })).toBeEnabled())

    fireEvent.change(screen.getByLabelText('GitHub 저장소 URL'), {
      target: { value: 'https://github.com/facebook/react' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await screen.findByText('react')

    await waitFor(
      async () => {
        const response = await fetch(`${API_BASE}/api/providers/github/items?limit=20`)
        const payload = (await response.json()) as {
          ok: boolean
          items: Array<{ id: string; provider: string; nativeId: string; title: string }>
        }

        expect(payload.ok).toBe(true)
        expect(payload.items.some((item) => item.id === 'github:facebook/react')).toBe(true)

        const item = payload.items.find((entry) => entry.id === 'github:facebook/react')
        expect(item?.provider).toBe('github')
        expect(item?.nativeId).toBe('facebook/react')
        expect(item?.title).toBe('facebook/react')
      },
      { timeout: 5000 },
    )
  })
})
