import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Category, YouTubeVideoCard } from '@shared/types'
import { YoutubeCard } from './YoutubeCard'

const categories: Category[] = [
  { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
]

describe('YoutubeCard', () => {
  const mockMatchMedia = (matches: boolean) => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches,
        media: '(hover: none), (pointer: coarse)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  }

  it('renders even when legacy data is missing videoId', () => {
    mockMatchMedia(false)

    const legacyCard = {
      id: 'legacy-id-only',
      categoryId: 'main',
      title: 'Legacy video',
      channelTitle: 'Legacy channel',
      description: '',
      thumbnailUrl: 'https://i.ytimg.com/vi/legacy-id-only/hqdefault.jpg',
      videoUrl: 'https://www.youtube.com/watch?v=legacy-id-only',
      publishedAt: '2026-01-01T00:00:00.000Z',
      viewCount: 0,
      likeCount: null,
      summaryText: 'legacy summary',
      summaryStatus: 'ready',
      summaryUpdatedAt: null,
      summaryProvider: 'none',
      summaryError: null,
      notebookSourceStatus: 'disabled',
      notebookSourceId: null,
      notebookId: null,
      addedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as YouTubeVideoCard

    render(
      <YoutubeCard
        card={legacyCard}
        categories={categories}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRetrySummary={vi.fn()}
      />,
    )

    expect(screen.getByText('Legacy video')).toBeInTheDocument()
    expect(screen.getAllByText('legacy summary')).toHaveLength(2)
  })

  it('opens summary tooltip on tap for coarse pointer devices', () => {
    mockMatchMedia(true)
    const card = {
      id: 'video-1',
      videoId: 'video-1',
      categoryId: 'main',
      title: 'Video 1',
      channelTitle: 'Channel 1',
      description: '',
      thumbnailUrl: 'https://i.ytimg.com/vi/video-1/hqdefault.jpg',
      videoUrl: 'https://www.youtube.com/watch?v=video-1',
      publishedAt: '2026-01-01T00:00:00.000Z',
      viewCount: 12,
      likeCount: null,
      summaryText: 'tap summary',
      summaryStatus: 'ready',
      summaryUpdatedAt: null,
      summaryProvider: 'none',
      summaryError: null,
      notebookSourceStatus: 'disabled',
      notebookSourceId: null,
      notebookId: null,
      addedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as YouTubeVideoCard

    const { container } = render(
      <YoutubeCard
        card={card}
        categories={categories}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRetrySummary={vi.fn()}
      />,
    )

    const summary = container.querySelector('.youtube-summary')
    const tooltipWrap = container.querySelector('.youtube-summary-tooltip-wrap')
    expect(summary).not.toBeNull()
    expect(tooltipWrap).not.toBeNull()
    expect(tooltipWrap?.classList.contains('is-open')).toBe(false)

    fireEvent.click(summary as Element)
    expect(tooltipWrap?.classList.contains('is-open')).toBe(true)

    fireEvent.click(summary as Element)
    expect(tooltipWrap?.classList.contains('is-open')).toBe(false)
  })
})
