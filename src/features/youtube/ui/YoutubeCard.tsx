import { useEffect, useRef, useState } from 'react'
import type { Category, CategoryId, YouTubeVideoCard } from '@shared/types'
import { formatDate, formatNumber } from '@utils/format'

type YoutubeCardProps = {
  card: YouTubeVideoCard
  categories: Category[]
  categoryName?: string | null
  onDelete: (videoId: string) => void
  onMove: (videoId: string, targetCategoryId: CategoryId) => void
  onRetrySummary: (videoId: string) => void
}

const summaryStatusLabel = (status: YouTubeVideoCard['summaryStatus']): string => {
  if (status === 'queued') {
    return '요약 준비중'
  }

  if (status === 'ready') {
    return '요약 완료'
  }

  if (status === 'failed') {
    return '요약 실패'
  }

  return '요약 대기'
}

export const YoutubeCard = ({
  card,
  categories,
  categoryName,
  onDelete,
  onMove,
  onRetrySummary,
}: YoutubeCardProps) => {
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false)
  const [isSummaryTooltipOpen, setIsSummaryTooltipOpen] = useState(false)
  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  const moveMenuRef = useRef<HTMLDivElement | null>(null)
  const summaryTooltipRef = useRef<HTMLDivElement | null>(null)
  const safeVideoId = String(card.videoId || card.id || 'unknown-video')
  const summaryText =
    card.summaryText || (card.summaryStatus === 'queued' ? '요약 생성 중입니다...' : '요약이 아직 없습니다.')
  const summaryTooltipId = `youtube-summary-tooltip-${safeVideoId.replace(/[^a-zA-Z0-9_-]/g, '-')}`

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
    <article className="repo-card youtube-card">
      <header className="repo-card-header">
        <div>
          <h3 className="youtube-title">{card.title}</h3>
          <p className="repo-owner">{card.channelTitle}</p>
          {categoryName ? <span className="repo-category-badge">{categoryName}</span> : null}
        </div>

        <div className="repo-card-actions">
          <div className="move-menu" ref={moveMenuRef}>
            <button
              type="button"
              className="move-button"
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
                    disabled={category.id === card.categoryId}
                    onClick={() => {
                      onMove(card.id, category.id)
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
            className="delete-button"
            onClick={() => onDelete(card.id)}
            aria-label={`${card.title} 삭제`}
          >
            삭제
          </button>
        </div>
      </header>

      <a href={card.videoUrl} target="_blank" rel="noreferrer" className="youtube-thumbnail-link" aria-label="YouTube 링크 열기">
        <img
          src={card.thumbnailUrl}
          alt={card.title}
          className="youtube-thumbnail"
          loading="lazy"
          decoding="async"
          width={640}
          height={360}
        />
      </a>

      <div className="repo-meta-line youtube-meta-line">
        <span>조회수: {formatNumber(card.viewCount)}</span>
        <span>게시일: {formatDate(card.publishedAt)}</span>
      </div>

      <section className="youtube-summary-panel" aria-live="polite">
        <div className="youtube-summary-header">
          <span className={`youtube-summary-badge summary-${card.summaryStatus}`}>{summaryStatusLabel(card.summaryStatus)}</span>
          {card.summaryStatus === 'failed' || card.summaryStatus === 'ready' ? (
            <button
              type="button"
              className="youtube-summary-retry"
              onClick={() => onRetrySummary(safeVideoId)}
            >
              요약 재생성
            </button>
          ) : null}
        </div>
        <div
          className={`youtube-summary-tooltip-wrap ${isSummaryTooltipOpen ? 'is-open' : ''}`}
          ref={summaryTooltipRef}
        >
          <p
            className="repo-summary youtube-summary"
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
          <span id={summaryTooltipId} role="tooltip" className="youtube-summary-tooltip">
            {summaryText}
          </span>
        </div>
        {card.summaryStatus === 'failed' && card.summaryError ? (
          <p className="youtube-summary-error">{card.summaryError}</p>
        ) : null}
      </section>

      <footer className="repo-card-footer">
        <a href={card.videoUrl} target="_blank" rel="noreferrer">
          YouTube 링크
        </a>
      </footer>
    </article>
  )
}
