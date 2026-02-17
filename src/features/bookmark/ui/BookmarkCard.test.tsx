import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BookmarkCard as BookmarkCardType, Category } from '@shared/types'
import { BookmarkCard } from './BookmarkCard'

const categories: Category[] = [
  { id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' },
]

const baseCard = (overrides: Partial<BookmarkCardType> = {}): BookmarkCardType => ({
  id: 'https://example.com/post',
  categoryId: 'main',
  url: 'https://example.com/post',
  normalizedUrl: 'https://example.com/post',
  canonicalUrl: null,
  domain: 'example.com',
  title: 'Example',
  excerpt: '기본 요약',
  summaryText: '',
  summaryStatus: 'idle',
  summaryProvider: 'none',
  summaryUpdatedAt: null,
  summaryError: null,
  thumbnailUrl: null,
  faviconUrl: null,
  tags: [],
  addedAt: '2026-02-17T00:00:00.000Z',
  updatedAt: '2026-02-17T00:00:00.000Z',
  metadataStatus: 'ok',
  linkStatus: 'unknown',
  lastCheckedAt: null,
  lastStatusCode: null,
  lastResolvedUrl: null,
  ...overrides,
})

describe('BookmarkCard', () => {
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

  it('renders regenerated summary text when ready', () => {
    mockMatchMedia(false)
    render(
      <BookmarkCard
        card={baseCard({ summaryText: '재생성 요약', summaryStatus: 'ready', summaryProvider: 'glm' })}
        categories={categories}
        summaryActionDisabled={false}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRetrySummary={vi.fn()}
      />,
    )

    expect(screen.getAllByText('재생성 요약').length).toBeGreaterThan(0)
  })

  it('opens summary tooltip on tap for coarse pointer devices', () => {
    mockMatchMedia(true)

    const { container } = render(
      <BookmarkCard
        card={baseCard({ summaryText: '긴 요약', summaryStatus: 'ready', summaryProvider: 'glm' })}
        categories={categories}
        summaryActionDisabled={false}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRetrySummary={vi.fn()}
      />,
    )

    const summary = container.querySelector('.bookmark-excerpt')
    const tooltipWrap = container.querySelector('.bookmark-summary-tooltip-wrap')
    expect(summary).not.toBeNull()
    expect(tooltipWrap).not.toBeNull()
    expect(tooltipWrap?.classList.contains('is-open')).toBe(false)

    fireEvent.click(summary as Element)
    expect(tooltipWrap?.classList.contains('is-open')).toBe(true)
  })
})
