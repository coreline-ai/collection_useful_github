import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOP_SECTION_STORAGE_KEY } from '@constants'
import { AppShell } from './AppShell'

vi.mock('@features/github/services/github', () => ({
  fetchRepo: vi.fn(),
  fetchRepoDetail: vi.fn().mockResolvedValue({ readmePreview: null, recentActivity: [] }),
  fetchLatestCommitSha: vi.fn().mockResolvedValue(null),
}))

vi.mock('@core/data/adapters/remoteDb', () => ({
  isRemoteSnapshotEnabled: vi.fn(() => false),
  getRemoteBaseUrl: vi.fn(() => null),
  searchUnifiedItems: vi.fn().mockResolvedValue([]),
  exportUnifiedBackup: vi.fn(),
  importUnifiedBackup: vi.fn(),
  loadGithubDashboardFromRemote: vi.fn().mockResolvedValue(null),
  saveGithubDashboardToRemote: vi.fn().mockResolvedValue(undefined),
  loadYoutubeDashboardFromRemote: vi.fn().mockResolvedValue(null),
  saveYoutubeDashboardToRemote: vi.fn().mockResolvedValue(undefined),
  loadBookmarkDashboardFromRemote: vi.fn().mockResolvedValue(null),
  saveBookmarkDashboardToRemote: vi.fn().mockResolvedValue(undefined),
  checkBookmarkLinkStatus: vi.fn(),
}))

describe('AppShell', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders github feature by default', () => {
    render(<AppShell />)

    expect(screen.getByRole('tab', { name: '깃허브' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('GitHub 저장소 URL')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '통합검색' })).toHaveAttribute('aria-selected', 'false')
  })

  it('switches to unified-search section and hides github board', () => {
    render(<AppShell />)

    fireEvent.click(screen.getByRole('tab', { name: '통합검색' }))

    expect(screen.getByRole('tab', { name: '통합검색' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('통합 검색어')).toBeInTheDocument()
    expect(screen.queryByLabelText('GitHub 저장소 URL')).not.toBeInTheDocument()
  })

  it('keeps unified-search input state across top section switches', () => {
    render(<AppShell />)

    fireEvent.click(screen.getByRole('tab', { name: '통합검색' }))
    fireEvent.change(screen.getByLabelText('통합 검색어'), { target: { value: 'react' } })

    fireEvent.click(screen.getByRole('tab', { name: '깃허브' }))
    fireEvent.click(screen.getByRole('tab', { name: '통합검색' }))

    expect(screen.getByLabelText('통합 검색어')).toHaveValue('react')
  })

  it('switches to bookmark board and hides github/search UI', () => {
    render(<AppShell />)

    fireEvent.click(screen.getByRole('tab', { name: '북마크' }))

    expect(screen.getByLabelText('북마크 URL')).toBeInTheDocument()
    expect(screen.getByLabelText('등록 카드 검색')).toBeInTheDocument()
    expect(screen.queryByLabelText('GitHub 저장소 URL')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '통합 검색어' })).not.toBeInTheDocument()
  })

  it('switches to youtube board with youtube input', () => {
    render(<AppShell />)

    fireEvent.click(screen.getByRole('tab', { name: '유튜브' }))

    expect(screen.getByLabelText('YouTube 영상 URL')).toBeInTheDocument()
    expect(screen.queryByLabelText('GitHub 저장소 URL')).not.toBeInTheDocument()
  })

  it('restores selected section from localStorage', () => {
    window.localStorage.setItem(TOP_SECTION_STORAGE_KEY, 'search')

    render(<AppShell />)

    expect(screen.getByRole('tab', { name: '통합검색' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('통합 검색어')).toBeInTheDocument()
  })
})
