import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

vi.mock('@features/github/services/github', () => ({
  fetchRepo: vi.fn(),
  fetchRepoDetail: vi.fn().mockResolvedValue({ readmePreview: null, recentActivity: [] }),
  fetchLatestCommitSha: vi.fn().mockResolvedValue(null),
}))

vi.mock('@core/data/adapters/remoteDb', () => ({
  isRemoteSnapshotEnabled: vi.fn(() => false),
  searchUnifiedItems: vi.fn().mockResolvedValue([]),
  exportUnifiedBackup: vi.fn(),
  importUnifiedBackup: vi.fn(),
  loadGithubDashboardFromRemote: vi.fn().mockResolvedValue(null),
  saveGithubDashboardToRemote: vi.fn().mockResolvedValue(undefined),
}))

const { isRemoteSnapshotEnabled, searchUnifiedItems } = await import('@core/data/adapters/remoteDb')

describe('AppShell', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(false)
    vi.mocked(searchUnifiedItems).mockResolvedValue([])
  })

  it('renders github feature by default', () => {
    render(<AppShell />)

    expect(screen.getByRole('tab', { name: '깃허브' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('GitHub 저장소 URL')).toBeInTheDocument()
    expect(screen.getByLabelText('통합 검색어')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '백업 내보내기' })).toBeInTheDocument()
  })

  it('switches non-github section to isolated placeholder', () => {
    render(<AppShell />)

    fireEvent.click(screen.getByRole('tab', { name: '북마크' }))

    expect(screen.getByText('북마크 기능은 준비중입니다.')).toBeInTheDocument()
    expect(screen.queryByLabelText('GitHub 저장소 URL')).not.toBeInTheDocument()
  })

  it('shows guide message when remote db search is disabled', () => {
    render(<AppShell />)

    fireEvent.change(screen.getByLabelText('통합 검색어'), { target: { value: 'react' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(screen.getByText('통합 검색은 원격 DB 연결 시 활성화됩니다.')).toBeInTheDocument()
  })

  it('renders search result when remote db search is enabled', async () => {
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(true)
    vi.mocked(searchUnifiedItems).mockResolvedValue([
      {
        id: 'github:facebook/react',
        provider: 'github',
        type: 'repository',
        nativeId: 'facebook/react',
        title: 'facebook/react',
        summary: 'React summary text',
        description: 'The library for web and native user interfaces.',
        url: 'https://github.com/facebook/react',
        tags: ['react'],
        author: 'facebook',
        language: 'TypeScript',
        metrics: { stars: 1, forks: 1 },
        status: 'active',
        createdAt: '2026-02-15T00:00:00.000Z',
        updatedAt: '2026-02-15T00:00:00.000Z',
        savedAt: '2026-02-15T00:00:00.000Z',
        raw: {},
      },
    ])

    render(<AppShell />)

    fireEvent.change(screen.getByLabelText('통합 검색어'), { target: { value: 'react' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(await screen.findByText('facebook/react')).toBeInTheDocument()
    expect(screen.getByText('React summary text')).toBeInTheDocument()
  })
})
