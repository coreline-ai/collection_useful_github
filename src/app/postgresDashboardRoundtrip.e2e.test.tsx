import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { GitHubRepoCard } from '@shared/types'

vi.mock('@features/github/services/github', () => ({
  fetchRepo: vi.fn(),
  fetchRepoDetail: vi.fn(),
  fetchLatestCommitSha: vi.fn(),
  regenerateGithubSummary: vi.fn(),
  fetchGithubSummaryStatus: vi.fn(),
}))

const { fetchRepo, fetchRepoDetail, fetchLatestCommitSha } = await import('@features/github/services/github')

const API_BASE =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VITE_POSTGRES_SYNC_API_BASE_URL ?? 'http://localhost:4000'
const shouldRunPostgresE2E =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RUN_POSTGRES_E2E ===
  'true'
const describeIfPostgresE2E = shouldRunPostgresE2E ? describe : describe.skip

const mockCard: GitHubRepoCard = {
  id: 'vercel/next.js',
  categoryId: 'main',
  owner: 'vercel',
  repo: 'next.js',
  fullName: 'vercel/next.js',
  description: 'The React Framework for the Web',
  summary: 'Next.js summary',
  htmlUrl: 'https://github.com/vercel/next.js',
  homepage: 'https://nextjs.org',
  language: 'TypeScript',
  stars: 10,
  forks: 2,
  watchers: 1,
  openIssues: 3,
  topics: ['react', 'framework'],
  license: 'MIT',
  defaultBranch: 'canary',
  createdAt: '2026-02-15T00:00:00.000Z',
  updatedAt: '2026-02-15T00:00:00.000Z',
  addedAt: '2026-02-15T00:00:00.000Z',
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

const resetGithubDashboard = async () => {
  const currentResponse = await fetch(`${API_BASE}/api/github/dashboard`)
  const currentPayload = (await currentResponse.json()) as { dashboard?: { revision?: number } }
  const expectedRevision =
    typeof currentPayload.dashboard?.revision === 'number' ? currentPayload.dashboard.revision : null

  return fetch(`${API_BASE}/api/github/dashboard`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dashboard: {
        cards: [],
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

describeIfPostgresE2E('PostgreSQL dashboard roundtrip E2E', () => {
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

    const resetDashboard = await resetGithubDashboard()

    if (!resetDashboard.ok) {
      throw new Error('Failed to reset dashboard')
    }
  })

  it('loads from postgres after page reload', async () => {
    vi.mocked(fetchRepo).mockResolvedValue(mockCard)

    const firstRender = render(<App />)

    await waitFor(() => expect(screen.getByRole('button', { name: '추가' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('GitHub 저장소 URL'), {
      target: { value: 'https://github.com/vercel/next.js' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await screen.findByText('next.js')

    await waitFor(
      async () => {
        const response = await fetch(`${API_BASE}/api/providers/github/items?limit=50`)
        const payload = (await response.json()) as { items: Array<{ id: string }> }
        expect(payload.items.some((item) => item.id === 'github:vercel/next.js')).toBe(true)
      },
      { timeout: 5000 },
    )

    firstRender.unmount()
    window.localStorage.clear()

    render(<App />)

    await screen.findByText('next.js')
    expect(screen.getAllByText('Next.js summary').length).toBeGreaterThan(0)
  })
})
