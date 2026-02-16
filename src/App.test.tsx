import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { THEME_STORAGE_KEY, TOP_SECTION_STORAGE_KEY } from './constants'
import type { GitHubRepoCard, RepoDetailData } from './types'

vi.mock('@features/github/services/github', () => ({
  fetchRepo: vi.fn(),
  fetchRepoDetail: vi.fn(),
  fetchLatestCommitSha: vi.fn(),
}))

vi.mock('@core/data/adapters/remoteDb', () => ({
  isRemoteSnapshotEnabled: vi.fn(() => false),
  loadGithubDashboardFromRemote: vi.fn().mockResolvedValue(null),
  saveGithubDashboardToRemote: vi.fn().mockResolvedValue(undefined),
  searchUnifiedItems: vi.fn().mockResolvedValue([]),
  exportUnifiedBackup: vi.fn().mockResolvedValue({
    version: 1,
    exportedAt: new Date(0).toISOString(),
    data: { items: [], notes: [], meta: {} },
  }),
  importUnifiedBackup: vi.fn().mockResolvedValue(undefined),
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

const mockDetail: RepoDetailData = {
  readmePreview: '# React\nA declarative JavaScript library for building user interfaces.',
  recentActivity: [
    {
      id: 'abc123',
      type: 'commit',
      title: 'fix: improve scheduler behavior',
      url: 'https://github.com/facebook/react/commit/abc123',
      author: 'gaearon',
      createdAt: '2026-02-14T10:20:00.000Z',
    },
  ],
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

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mockMatchMedia(false)
    vi.mocked(fetchRepoDetail).mockResolvedValue(mockDetail)
    vi.mocked(fetchLatestCommitSha).mockResolvedValue('abc123')
  })

  it('uses system dark mode on first load when no saved theme', () => {
    mockMatchMedia(true)

    render(<App />)

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('uses saved theme over system preference and toggles with persistence', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    mockMatchMedia(true)

    render(<App />)

    expect(document.documentElement.dataset.theme).toBe('light')

    fireEvent.click(screen.getByRole('button', { name: '다크 테마 켜기' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('shows github section by default', () => {
    render(<App />)

    expect(screen.getByRole('tab', { name: '깃허브' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('GitHub 저장소 URL')).toBeInTheDocument()
  })

  it('switches to youtube placeholder and hides github board', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: '유튜브' }))

    expect(screen.getByText('유튜브 기능은 준비중입니다.')).toBeInTheDocument()
    expect(screen.queryByLabelText('GitHub 저장소 URL')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(TOP_SECTION_STORAGE_KEY)).toBe('youtube')
  })

  it('restores selected top section from storage', () => {
    window.localStorage.setItem(TOP_SECTION_STORAGE_KEY, 'bookmark')

    render(<App />)

    expect(screen.getByRole('tab', { name: '북마크' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('북마크 기능은 준비중입니다.')).toBeInTheDocument()
  })

  it('adds repo card and blocks duplicate', async () => {
    vi.mocked(fetchRepo).mockResolvedValue(mockCard)

    render(<App />)

    const input = screen.getByLabelText('GitHub 저장소 URL')
    fireEvent.change(input, { target: { value: 'facebook/react' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await screen.findByText('react')
    expect(screen.getByText('React summary text')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'facebook/react' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('이미 추가된 저장소입니다.')).toBeInTheDocument()

    await waitFor(() => {
      const cards = JSON.parse(window.localStorage.getItem('github_cards_v1') ?? '[]') as GitHubRepoCard[]
      expect(cards).toHaveLength(1)
    })
  })

  it('shows input only in main category', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '카테고리 설정' }))
    fireEvent.change(screen.getByLabelText('새 카테고리 이름'), { target: { value: '프론트엔드' } })
    fireEvent.click(screen.getByRole('button', { name: '카테고리 생성' }))
    fireEvent.click(screen.getByRole('button', { name: '카테고리 설정 닫기' }))

    expect(await screen.findByRole('button', { name: '프론트엔드' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '프론트엔드' }))

    expect(screen.queryByLabelText('GitHub 저장소 URL')).not.toBeInTheDocument()
    expect(screen.getByText('저장소 추가는 메인 카테고리에서만 가능합니다.')).toBeInTheDocument()
  })

  it('moves card to another category from card menu', async () => {
    vi.mocked(fetchRepo).mockResolvedValue(mockCard)

    render(<App />)

    fireEvent.change(screen.getByLabelText('GitHub 저장소 URL'), {
      target: { value: 'https://github.com/facebook/react' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await screen.findByText('react')

    fireEvent.click(screen.getByRole('button', { name: '카테고리 설정' }))
    fireEvent.change(screen.getByLabelText('새 카테고리 이름'), { target: { value: '프론트엔드' } })
    fireEvent.click(screen.getByRole('button', { name: '카테고리 생성' }))
    fireEvent.click(screen.getByRole('button', { name: '카테고리 설정 닫기' }))

    fireEvent.click(screen.getByRole('button', { name: '메인' }))
    const moveTrigger = screen.getByRole('button', { name: '카테고리 이동' })
    fireEvent.click(moveTrigger)
    const moveMenu = moveTrigger.closest('.move-menu')
    expect(moveMenu).not.toBeNull()
    fireEvent.click(within(moveMenu as HTMLElement).getByRole('button', { name: '프론트엔드' }))

    expect(screen.queryByText('react')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '프론트엔드' }))
    expect(await screen.findByText('react')).toBeInTheDocument()
  })

  it('opens detail modal and adds note', async () => {
    vi.mocked(fetchRepo).mockResolvedValue(mockCard)

    render(<App />)

    fireEvent.change(screen.getByLabelText('GitHub 저장소 URL'), {
      target: { value: 'https://github.com/facebook/react' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await screen.findByText('상세 보기')
    fireEvent.click(screen.getByRole('button', { name: '상세 보기' }))

    await screen.findByRole('dialog')
    await screen.findByRole('button', { name: 'README' })

    fireEvent.change(screen.getByPlaceholderText('간단한 아이디어나 작업 기록을 남겨 보세요.'), {
      target: { value: '테스트 메모' },
    })
    fireEvent.click(screen.getByRole('button', { name: '입력' }))

    expect(await screen.findByText('테스트 메모')).toBeInTheDocument()

    await waitFor(() => {
      const notes = JSON.parse(window.localStorage.getItem('github_notes_v1') ?? '{}') as Record<
        string,
        { content: string }[]
      >
      expect(notes['facebook/react'][0].content).toBe('테스트 메모')
    })
  })
})
