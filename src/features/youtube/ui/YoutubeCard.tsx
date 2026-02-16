import { useEffect, useRef, useState } from 'react'
import type { Category, CategoryId, YouTubeVideoCard } from '@shared/types'
import { formatDate, formatNumber } from '@utils/format'

type YoutubeCardProps = {
  card: YouTubeVideoCard
  categories: Category[]
  categoryName?: string | null
  onDelete: (videoId: string) => void
  onMove: (videoId: string, targetCategoryId: CategoryId) => void
}

export const YoutubeCard = ({ card, categories, categoryName, onDelete, onMove }: YoutubeCardProps) => {
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false)
  const moveMenuRef = useRef<HTMLDivElement | null>(null)

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
        <img src={card.thumbnailUrl} alt={card.title} className="youtube-thumbnail" loading="lazy" />
      </a>

      <div className="repo-meta-line youtube-meta-line">
        <span>조회수: {formatNumber(card.viewCount)}</span>
        <span>게시일: {formatDate(card.publishedAt)}</span>
      </div>

      <footer className="repo-card-footer">
        <a href={card.videoUrl} target="_blank" rel="noreferrer">
          YouTube 링크
        </a>
      </footer>
    </article>
  )
}
