import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { THEME_STORAGE_KEY, TOP_SECTION_STORAGE_KEY } from './constants'
import type { BookmarkCard, GitHubRepoCard, RepoDetailData, YouTubeVideoCard } from './types'

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

vi.mock('@features/bookmark/services/bookmark', () => ({
  parseBookmarkUrl: vi.fn(),
  fetchBookmarkMetadata: vi.fn(),
  createBookmarkCardFromDraft: vi.fn((draft: Omit<BookmarkCard, 'categoryId' | 'addedAt'>) => ({
    ...draft,
    categoryId: 'main',
    addedAt: '2026-02-15T00:00:00.000Z',
  })),
}))

vi.mock('@core/data/adapters/remoteDb', () => ({
  isRemoteSnapshotEnabled: vi.fn(() => false),
  getRemoteBaseUrl: vi.fn(() => null),
  loadGithubDashboardFromRemote: vi.fn().mockResolvedValue(null),
  saveGithubDashboardToRemote: vi.fn().mockResolvedValue(undefined),
  loadYoutubeDashboardFromRemote: vi.fn().mockResolvedValue(null),
  saveYoutubeDashboardToRemote: vi.fn().mockResolvedValue(undefined),
  loadBookmarkDashboardFromRemote: vi.fn().mockResolvedValue(null),
  saveBookmarkDashboardToRemote: vi.fn().mockResolvedValue(undefined),
  searchUnifiedItems: vi.fn().mockResolvedValue([]),
  exportUnifiedBackup: vi.fn().mockResolvedValue({
    version: 1,
    exportedAt: new Date(0).toISOString(),
    data: { items: [], notes: [], meta: {} },
  }),
  importUnifiedBackup: vi.fn().mockResolvedValue(undefined),
}))

const { fetchRepo, fetchRepoDetail, fetchLatestCommitSha } = await import('@features/github/services/github')
const { parseYouTubeVideoUrl, fetchYouTubeVideo } = await import('@features/youtube/services/youtube')
const { parseBookmarkUrl, fetchBookmarkMetadata } = await import('@features/bookmark/services/bookmark')
const {
  isRemoteSnapshotEnabled,
  loadGithubDashboardFromRemote,
  saveGithubDashboardToRemote,
  loadYoutubeDashboardFromRemote,
  saveYoutubeDashboardToRemote,
} = await import('@core/data/adapters/remoteDb')

const mockReactCard: GitHubRepoCard = {
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

const mockVueCard: GitHubRepoCard = {
  ...mockReactCard,
  id: 'vuejs/core',
  owner: 'vuejs',
  repo: 'core',
  fullName: 'vuejs/core',
  summary: 'Vue summary text',
  htmlUrl: 'https://github.com/vuejs/core',
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

const mockBookmarkDraft: Omit<BookmarkCard, 'categoryId' | 'addedAt'> = {
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
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(false)
    vi.mocked(loadGithubDashboardFromRemote).mockResolvedValue(null)
    vi.mocked(saveGithubDashboardToRemote).mockResolvedValue(undefined)
    vi.mocked(loadYoutubeDashboardFromRemote).mockResolvedValue(null)
    vi.mocked(saveYoutubeDashboardToRemote).mockResolvedValue(undefined)
    vi.mocked(fetchRepoDetail).mockResolvedValue(mockDetail)
    vi.mocked(fetchLatestCommitSha).mockResolvedValue('abc123')
    vi.mocked(parseYouTubeVideoUrl).mockImplementation((input: string) =>
      input.includes('watch?v=') ? { videoId: 'dQw4w9WgXcQ' } : null,
    )
    vi.mocked(fetchYouTubeVideo).mockResolvedValue(mockYoutubeCard)
    vi.mocked(parseBookmarkUrl).mockImplementation((input: string) =>
      input.includes('openai.com/research')
        ? {
            url: 'https://openai.com/research',
            normalizedUrl: 'https://openai.com/research',
            domain: 'openai.com',
          }
        : null,
    )
    vi.mocked(fetchBookmarkMetadata).mockResolvedValue(mockBookmarkDraft)
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

  it('shows github section by default with local search input', () => {
    render(<App />)

    expect(screen.getByRole('tab', { name: '깃허브' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('GitHub 저장소 URL')).toBeInTheDocument()
    expect(screen.getByLabelText('등록 카드 검색')).toBeInTheDocument()
  })

  it('switches to youtube board and hides github board', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: '유튜브' }))

    expect(screen.getByLabelText('YouTube 영상 URL')).toBeInTheDocument()
    expect(screen.getByLabelText('등록 카드 검색')).toBeInTheDocument()
    expect(screen.queryByLabelText('GitHub 저장소 URL')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(TOP_SECTION_STORAGE_KEY)).toBe('youtube')
  })

  it('adds youtube card and filters within youtube tab', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: '유튜브' }))
    fireEvent.change(screen.getByLabelText('YouTube 영상 URL'), {
      target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await screen.findByText('Never Gonna Give You Up')
    expect(screen.getByText('Rick Astley')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('등록 카드 검색'), { target: { value: 'rick' } })
    expect(screen.getByText('검색 중에는 전체 카테고리 카드에서 결과를 표시합니다.')).toBeInTheDocument()
    expect(screen.getByText('Never Gonna Give You Up')).toBeInTheDocument()
  })

  it('adds bookmark card and filters within bookmark tab', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: '북마크' }))
    fireEvent.change(screen.getByLabelText('북마크 URL'), {
      target: { value: 'https://openai.com/research' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await screen.findByText('OpenAI Research')
    expect(screen.getByText('openai.com', { selector: '.repo-owner' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '북마크 링크 열기' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('등록 카드 검색'), { target: { value: 'openai' } })
    expect(screen.getByText('검색 중에는 전체 카테고리 카드에서 결과를 표시합니다.')).toBeInTheDocument()
    expect(screen.getByText('OpenAI Research')).toBeInTheDocument()
  })

  it('does not immediately degrade to local-only mode on first transient youtube remote save failure', async () => {
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(true)
    vi.mocked(saveYoutubeDashboardToRemote)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(undefined)

    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: '유튜브' }))

    await waitFor(() =>
      expect(screen.getByText(/원격 저장 연결이 불안정합니다\. 자동 재시도 중입니다\./)).toBeInTheDocument(),
    )
    expect(screen.queryByText('로컬 전환')).not.toBeInTheDocument()
    expect(screen.queryByText(/로컬 저장으로 전환했습니다\./)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '카테고리 설정' }))
    fireEvent.change(screen.getByLabelText('새 카테고리 이름'), { target: { value: '복구확인' } })
    fireEvent.click(screen.getByRole('button', { name: '카테고리 생성' }))

    await waitFor(() =>
      expect(screen.queryByText(/원격 저장 연결이 불안정합니다\. 자동 재시도 중입니다\./)).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('로컬 전환')).not.toBeInTheDocument()
    expect(screen.queryByText(/로컬 저장으로 전환했습니다\./)).not.toBeInTheDocument()
  })

  it('does not overwrite remote github snapshot when initial remote load fails', async () => {
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(true)
    vi.mocked(loadGithubDashboardFromRemote).mockRejectedValue(new TypeError('Failed to fetch'))

    render(<App />)

    await waitFor(() => {
      expect(loadGithubDashboardFromRemote).toHaveBeenCalled()
    })

    expect(saveGithubDashboardToRemote).not.toHaveBeenCalled()
  })

  it('restores selected top section from storage', () => {
    window.localStorage.setItem(TOP_SECTION_STORAGE_KEY, 'bookmark')

    render(<App />)

    expect(screen.getByRole('tab', { name: '북마크' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('북마크 URL')).toBeInTheDocument()
    expect(screen.getByLabelText('등록 카드 검색')).toBeInTheDocument()
  })

  it('adds repo card and blocks duplicate', async () => {
    vi.mocked(fetchRepo).mockResolvedValue(mockReactCard)

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

  it('filters registered cards in real time and searches across all categories in main', async () => {
    vi.mocked(fetchRepo).mockResolvedValueOnce(mockReactCard).mockResolvedValueOnce(mockVueCard)

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

    fireEvent.change(screen.getByLabelText('GitHub 저장소 URL'), {
      target: { value: 'https://github.com/vuejs/core' },
    })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await screen.findByText('core')

    const searchInput = screen.getByLabelText('등록 카드 검색')
    fireEvent.change(searchInput, { target: { value: 'react' } })

    expect(screen.getByText('검색 중에는 전체 카테고리 카드에서 결과를 표시합니다.')).toBeInTheDocument()
    expect(screen.getByText('react')).toBeInTheDocument()
    expect(screen.queryByText('core')).not.toBeInTheDocument()
    expect(screen.getByText('프론트엔드', { selector: '.repo-category-badge' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '등록 카드 검색 초기화' }))

    expect(await screen.findByText('core')).toBeInTheDocument()
    expect(screen.queryByText('react')).not.toBeInTheDocument()
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
    expect(screen.queryByLabelText('등록 카드 검색')).not.toBeInTheDocument()
    expect(screen.getByText('저장소 추가는 메인 카테고리에서만 가능합니다.')).toBeInTheDocument()
  })

  it('opens detail modal and adds note', async () => {
    vi.mocked(fetchRepo).mockResolvedValue(mockReactCard)

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
      const savedContents = Object.values(notes)
        .flat()
        .map((note) => note.content)
      expect(savedContents).toContain('테스트 메모')
    })
  })
})
