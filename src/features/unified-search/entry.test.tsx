import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIFIED_RECENT_QUERIES_STORAGE_KEY } from '@constants'
import { UnifiedSearchFeatureEntry } from './entry'

vi.mock('@core/data/adapters/remoteDb', () => ({
  isRemoteSnapshotEnabled: vi.fn(() => false),
  searchUnifiedItems: vi.fn().mockResolvedValue([]),
  exportUnifiedBackup: vi.fn(),
  importUnifiedBackup: vi.fn(),
}))

const { isRemoteSnapshotEnabled, searchUnifiedItems, exportUnifiedBackup, importUnifiedBackup } = await import(
  '@core/data/adapters/remoteDb'
)

describe('UnifiedSearchFeatureEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(false)
    vi.mocked(searchUnifiedItems).mockResolvedValue([])
  })

  it('shows validation message for empty query', () => {
    render(<UnifiedSearchFeatureEntry />)

    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    expect(screen.getByText('검색어를 입력해 주세요.')).toBeInTheDocument()
  })

  it('shows guide when remote db is disabled', () => {
    render(<UnifiedSearchFeatureEntry />)

    fireEvent.change(screen.getByLabelText('통합 검색어'), { target: { value: 'react' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(screen.getByText('통합 검색은 원격 DB 연결 시 활성화됩니다.')).toBeInTheDocument()
  })

  it('forwards provider/type filter and renders empty message', async () => {
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(true)
    vi.mocked(searchUnifiedItems).mockResolvedValue([])

    render(<UnifiedSearchFeatureEntry />)

    fireEvent.change(screen.getByLabelText('통합 검색어'), { target: { value: 'react' } })
    fireEvent.change(screen.getByLabelText('검색 provider'), { target: { value: 'github' } })
    fireEvent.change(screen.getByLabelText('검색 타입'), { target: { value: 'repository' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    await waitFor(() => {
      expect(searchUnifiedItems).toHaveBeenCalledWith({
        query: 'react',
        provider: 'github',
        type: 'repository',
        limit: 40,
        mode: 'relevance',
        fuzzy: true,
        prefix: true,
        minScore: 0,
      })
    })

    expect(screen.getByText('검색 결과가 없습니다.')).toBeInTheDocument()
  })

  it('uses memory cache for repeated same query', async () => {
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(true)
    vi.mocked(searchUnifiedItems).mockResolvedValue([
      {
        id: 'github:facebook/react',
        provider: 'github',
        type: 'repository',
        nativeId: 'facebook/react',
        title: 'facebook/react',
        summary: 'React summary',
        description: 'React description',
        url: 'https://github.com/facebook/react',
        tags: ['react'],
        author: 'facebook',
        language: 'TypeScript',
        metrics: { stars: 1, forks: 1 },
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        savedAt: '2026-01-01T00:00:00.000Z',
        raw: {},
      },
    ])

    render(<UnifiedSearchFeatureEntry />)

    fireEvent.change(screen.getByLabelText('통합 검색어'), { target: { value: 'react' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await screen.findByText('facebook/react')

    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(searchUnifiedItems).toHaveBeenCalledTimes(1)
  })

  it('stores recent searches and allows quick replay', async () => {
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(true)
    vi.mocked(searchUnifiedItems).mockResolvedValue([])

    render(<UnifiedSearchFeatureEntry />)

    fireEvent.change(screen.getByLabelText('통합 검색어'), { target: { value: 'react' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(await screen.findByText('최근 검색어')).toBeInTheDocument()

    const stored = JSON.parse(window.localStorage.getItem(UNIFIED_RECENT_QUERIES_STORAGE_KEY) || '[]') as Array<{
      q: string
    }>
    expect(stored[0]?.q).toBe('react')

    fireEvent.click(screen.getByRole('button', { name: /react/ }))
    expect(searchUnifiedItems).toHaveBeenCalledTimes(1)
  })

  it('renders search result list', async () => {
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(true)
    vi.mocked(searchUnifiedItems).mockResolvedValue([
      {
        id: 'github:facebook/react',
        provider: 'github',
        type: 'repository',
        nativeId: 'facebook/react',
        title: 'facebook/react',
        summary: 'React summary',
        description: 'React description',
        url: 'https://github.com/facebook/react',
        tags: ['react'],
        author: 'facebook',
        language: 'TypeScript',
        metrics: { stars: 1, forks: 1 },
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        savedAt: '2026-01-01T00:00:00.000Z',
        raw: {},
      },
    ])

    render(<UnifiedSearchFeatureEntry />)

    fireEvent.change(screen.getByLabelText('통합 검색어'), { target: { value: 'react' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(await screen.findByText('facebook/react')).toBeInTheDocument()
    expect(screen.getByText('React summary')).toBeInTheDocument()
  })

  it('shows api error message when search request fails', async () => {
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(true)
    vi.mocked(searchUnifiedItems).mockRejectedValue(new Error('search failed'))

    render(<UnifiedSearchFeatureEntry />)

    fireEvent.change(screen.getByLabelText('통합 검색어'), { target: { value: 'react' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(await screen.findByText('search failed')).toBeInTheDocument()
  })

  it('exports backup', async () => {
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(true)
    vi.mocked(exportUnifiedBackup).mockResolvedValue({
      version: 1,
      exportedAt: new Date(0).toISOString(),
      data: { items: [], notes: [], meta: {} },
    })

    const createObjectURL = vi.fn(() => 'blob:backup')
    const revokeObjectURL = vi.fn()
    const click = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') {
        return { href: '', download: '', click } as unknown as HTMLElement
      }

      return originalCreateElement(tagName)
    })
    const createObjectUrlSpy = vi.spyOn(window.URL, 'createObjectURL').mockImplementation(createObjectURL)
    const revokeObjectUrlSpy = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(revokeObjectURL)

    render(<UnifiedSearchFeatureEntry />)

    fireEvent.click(screen.getByRole('button', { name: '백업 내보내기' }))

    expect(await screen.findByText('백업 파일을 다운로드했습니다.')).toBeInTheDocument()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup')

    createElementSpy.mockRestore()
    createObjectUrlSpy.mockRestore()
    revokeObjectUrlSpy.mockRestore()
  })

  it('imports backup payload from json file', async () => {
    vi.mocked(isRemoteSnapshotEnabled).mockReturnValue(true)
    vi.mocked(importUnifiedBackup).mockResolvedValue(undefined)

    render(<UnifiedSearchFeatureEntry />)

    const payload = {
      version: 1,
      exportedAt: new Date(0).toISOString(),
      data: { items: [], notes: [], meta: {} },
    }
    const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' })
    const input = screen.getByLabelText('통합검색').querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(importUnifiedBackup).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('백업 복원이 완료되었습니다. 화면을 새로고침합니다.')).toBeInTheDocument()
  })
})
