import { useEffect, useRef, useState } from 'react'
import type { BookmarkCard as BookmarkCardType, Category, CategoryId } from '@shared/types'
import { formatDate } from '@utils/format'

type BookmarkCardProps = {
  card: BookmarkCardType
  categories: Category[]
  categoryName?: string | null
  onDelete: (normalizedUrl: string) => void
  onMove: (normalizedUrl: string, targetCategoryId: CategoryId) => void
}

export const BookmarkCard = ({
  card,
  categories,
  categoryName,
  onDelete,
  onMove,
}: BookmarkCardProps) => {
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
            className="delete-button"
            onClick={() => onDelete(card.normalizedUrl)}
            aria-label={`${card.title} 삭제`}
          >
            삭제
          </button>
        </div>
      </header>

      <a href={card.url} target="_blank" rel="noreferrer" className="bookmark-preview-link" aria-label="북마크 링크 열기">
        {card.thumbnailUrl ? (
          <img src={card.thumbnailUrl} alt={card.title} className="bookmark-thumbnail" loading="lazy" />
        ) : (
          <div className="bookmark-thumbnail bookmark-thumbnail-fallback">{card.domain}</div>
        )}
      </a>

      <p className="repo-summary bookmark-excerpt">{card.excerpt}</p>

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
