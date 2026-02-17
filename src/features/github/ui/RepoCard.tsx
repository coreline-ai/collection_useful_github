import { useEffect, useRef, useState } from 'react'
import type { Category, CategoryId, GitHubRepoCard } from '@shared/types'
import { formatDate, formatNumber } from '@utils/format'

type RepoCardProps = {
  repo: GitHubRepoCard
  categories: Category[]
  categoryName?: string | null
  readOnly?: boolean
  onOpenDetail: (repoId: string) => void
  onDelete: (repoId: string) => void
  onMove: (repoId: string, targetCategoryId: CategoryId) => void
  onRegenerateSummary: (repoId: string) => void
}

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="stat-item">
    <span>{label}</span>
    <strong>{formatNumber(value)}</strong>
  </div>
)

const summaryStatusLabel = (status: GitHubRepoCard['summaryStatus']): string => {
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

export const RepoCard = ({
  repo,
  categories,
  categoryName,
  readOnly = false,
  onOpenDetail,
  onDelete,
  onMove,
  onRegenerateSummary,
}: RepoCardProps) => {
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false)
  const moveMenuRef = useRef<HTMLDivElement | null>(null)
  const summaryStatus = repo.summaryStatus ?? (repo.summary.trim() ? 'ready' : 'idle')
  const summaryText = repo.summary?.trim() || '요약 정보가 없습니다.'
  const summaryTooltipId = `github-summary-tooltip-${repo.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

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
    <article className="repo-card" onClick={() => onOpenDetail(repo.id)}>
      <header className="repo-card-header">
        <div>
          <h3>{repo.repo}</h3>
          <p className="repo-owner">{repo.owner}</p>
          {categoryName ? <span className="repo-category-badge">{categoryName}</span> : null}
        </div>

        <div className="repo-card-actions">
          <div className="move-menu" ref={moveMenuRef}>
            <button
              type="button"
              className="move-button"
              aria-label="카테고리 이동"
              disabled={readOnly}
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
                    disabled={readOnly || category.id === repo.categoryId}
                    onClick={() => {
                      onMove(repo.id, category.id)
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
            disabled={readOnly}
            onClick={(event) => {
              event.stopPropagation()
              onDelete(repo.id)
            }}
            aria-label={`${repo.fullName} 삭제`}
          >
            삭제
          </button>
        </div>
      </header>

      <div className="github-summary-tooltip-wrap">
        <p className="repo-summary" aria-describedby={summaryTooltipId} tabIndex={0}>
          {summaryText}
        </p>
        <span id={summaryTooltipId} role="tooltip" className="github-summary-tooltip">
          {summaryText}
        </span>
      </div>

      <div className="repo-summary-controls" onClick={(event) => event.stopPropagation()}>
        <span className={`repo-summary-badge summary-${summaryStatus}`}>{summaryStatusLabel(summaryStatus)}</span>
        <button
          type="button"
          className="repo-summary-refresh"
          disabled={readOnly || summaryStatus === 'queued'}
          onClick={() => onRegenerateSummary(repo.id)}
        >
          {summaryStatus === 'queued' ? '생성중...' : '요약 재생성'}
        </button>
      </div>
      {summaryStatus === 'failed' && repo.summaryError ? (
        <p className="repo-summary-error">{repo.summaryError}</p>
      ) : null}

      <div className="repo-meta-line">
        <span>언어: {repo.language ?? 'N/A'}</span>
        <span>업데이트: {formatDate(repo.updatedAt)}</span>
      </div>

      <div className="stats-grid">
        <Stat label="Stars" value={repo.stars} />
        <Stat label="Forks" value={repo.forks} />
      </div>

      <footer className="repo-card-footer">
        <a
          href={repo.htmlUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          GitHub 링크
        </a>
        <button
          type="button"
          className="detail-button"
          onClick={(event) => {
            event.stopPropagation()
            onOpenDetail(repo.id)
          }}
        >
          상세 보기
        </button>
      </footer>
    </article>
  )
}
