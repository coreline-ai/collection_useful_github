import { useEffect, useRef, useState } from 'react'
import type { BookmarkCard as BookmarkCardType, Category, CategoryId } from '@shared/types'
import { formatDate } from '@utils/format'

type BookmarkCardProps = {
  card: BookmarkCardType
  categories: Category[]
  categoryName?: string | null
  summaryActionDisabled: boolean
  onDelete: (normalizedUrl: string) => void
  onMove: (normalizedUrl: string, targetCategoryId: CategoryId) => void
  onRetrySummary: (normalizedUrl: string) => void
}

const summaryStatusLabel = (status: BookmarkCardType['summaryStatus']): string => {
  if (status === 'queued') {
    return '요약 생성중'
  }

  if (status === 'ready') {
    return '요약 완료'
  }

  if (status === 'failed') {
    return '요약 실패'
  }

  return '요약 대기'
}

export const BookmarkCard = ({
  card,
  categories,
  categoryName,
  summaryActionDisabled,
  onDelete,
  onMove,
  onRetrySummary,
}: BookmarkCardProps) => {
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false)
  const [isSummaryTooltipOpen, setIsSummaryTooltipOpen] = useState(false)
  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  const moveMenuRef = useRef<HTMLDivElement | null>(null)
  const summaryTooltipRef = useRef<HTMLDivElement | null>(null)
  const safeBookmarkId = String(card.normalizedUrl || card.id || 'bookmark')
  const summaryText =
    card.summaryStatus === 'ready' && card.summaryText.trim() ? card.summaryText : card.excerpt
  const summaryTooltipId = `bookmark-summary-tooltip-${safeBookmarkId.replace(/[^a-zA-Z0-9_-]/g, '-')}`

  useEffect(() => {
    if (!isMoveMenuOpen) {
      return
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (moveMenuRef.current?.contains(event.target as Node)) {
        return
      }

      setIsMoveMenuOpen(false)
    }

    window.addEventListener('mousedown', handleOutsideClick)
    return () => window.removeEventListener('mousedown', handleOutsideClick)
  }, [isMoveMenuOpen])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia('(hover: none), (pointer: coarse)')
    const apply = () => {
      setIsCoarsePointer(mediaQuery.matches)
    }

    apply()
    mediaQuery.addEventListener('change', apply)
    return () => {
      mediaQuery.removeEventListener('change', apply)
    }
  }, [])

  useEffect(() => {
    if (!isSummaryTooltipOpen) {
      return
    }

    const closeIfOutside = (event: MouseEvent | TouchEvent) => {
      if (summaryTooltipRef.current?.contains(event.target as Node)) {
        return
      }
      setIsSummaryTooltipOpen(false)
    }

    window.addEventListener('mousedown', closeIfOutside)
    window.addEventListener('touchstart', closeIfOutside, { passive: true })
    return () => {
      window.removeEventListener('mousedown', closeIfOutside)
      window.removeEventListener('touchstart', closeIfOutside)
    }
  }, [isSummaryTooltipOpen])

  return (
    <article className="repo-card bookmark-card">
      <header className="repo-card-header">
        <div>
          <h3 className="bookmark-title">{card.title}</h3>
          <p className="repo-owner">{card.domain}</p>
          {categoryName ? <span className="repo-category-badge">{categoryName}</span> : null}
        </div>

        <div className="repo-card-actions">
          <div className="move-menu" ref={moveMenuRef}>
            <button
              type="button"
              className="btn btn-secondary btn-icon move-button"
              aria-label="카테고리 이동"
              onClick={(event) => {
                event.stopPropagation()
                setIsMoveMenuOpen((current) => !current)
              }}
            >
              ▾
            </button>

            {isMoveMenuOpen ? (
              <div className="move-menu-popover" onClick={(event) => event.stopPropagation()}>
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className="btn btn-secondary"
                    disabled={category.id === card.categoryId}
                    onClick={() => {
                      onMove(card.normalizedUrl, category.id)
                      setIsMoveMenuOpen(false)
                    }}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="btn btn-danger delete-button"
            onClick={() => onDelete(card.normalizedUrl)}
            aria-label={`${card.title} 삭제`}
          >
            삭제
          </button>
        </div>
      </header>

      <a href={card.url} target="_blank" rel="noreferrer" className="bookmark-preview-link" aria-label="북마크 링크 열기">
        {card.thumbnailUrl ? (
          <img
            src={card.thumbnailUrl}
            alt={card.title}
            className="bookmark-thumbnail"
            loading="lazy"
            decoding="async"
            width={640}
            height={360}
          />
        ) : (
          <div className="bookmark-thumbnail bookmark-thumbnail-fallback">{card.domain}</div>
        )}
      </a>

      <section className="bookmark-summary-panel" aria-live="polite">
        <div className="bookmark-summary-header">
          <span className={`bookmark-summary-badge summary-${card.summaryStatus}`}>
            {summaryStatusLabel(card.summaryStatus)}
          </span>
          <button
            type="button"
            className="btn btn-secondary bookmark-summary-retry"
            onClick={() => onRetrySummary(card.normalizedUrl)}
            disabled={summaryActionDisabled || card.summaryStatus === 'queued'}
          >
            {card.summaryStatus === 'queued' ? '생성중...' : '요약 재생성'}
          </button>
        </div>
        <div
          className={`bookmark-summary-tooltip-wrap ${isSummaryTooltipOpen ? 'is-open' : ''}`}
          ref={summaryTooltipRef}
        >
          <p
            className="repo-summary bookmark-excerpt"
            aria-describedby={summaryTooltipId}
            tabIndex={0}
            onClick={() => {
              if (!isCoarsePointer) {
                return
              }
              setIsSummaryTooltipOpen((current) => !current)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') {
                return
              }
              event.preventDefault()
              setIsSummaryTooltipOpen((current) => !current)
            }}
          >
            {summaryText}
          </p>
          <span id={summaryTooltipId} role="tooltip" className="bookmark-summary-tooltip">
            {summaryText}
          </span>
        </div>
        {card.summaryStatus === 'failed' && card.summaryError ? (
          <p className="bookmark-summary-error">{card.summaryError}</p>
        ) : null}
      </section>

      <footer className="repo-card-footer">
        <div className="bookmark-footer-left">
          <a href={card.url} target="_blank" rel="noreferrer">
            링크 열기
          </a>
        </div>

        <div className="bookmark-footer-right">
          <span className="bookmark-added-at">추가일: {formatDate(card.addedAt)}</span>
          {card.metadataStatus === 'fallback' ? (
            <span className="bookmark-meta-badge">기본 메타</span>
          ) : null}
        </div>
      </footer>
    </article>
  )
}
