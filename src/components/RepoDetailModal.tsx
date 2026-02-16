import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { MAX_NOTE_LENGTH } from '../constants'
import { fetchLatestCommitSha, fetchRepoDetail } from '../services/github'
import { translateBatchToKorean, translateToKorean } from '../services/translation'
import { getRepoDetailCache, upsertRepoDetailCache } from '../storage/detailCache'
import type { GitHubRepoCard, RepoDetailData, RepoNote } from '../types'
import { formatDate, formatDateTime, formatNumber } from '../utils/format'
import { renderMarkdownToSafeHtml } from '../utils/markdown'

type RepoDetailModalProps = {
  repo: GitHubRepoCard | null
  notes: RepoNote[]
  onClose: () => void
  onAddNote: (repoId: string, content: string) => void
}

type DetailTab = 'overview' | 'readme' | 'activity'
type TranslationLoadingState = Record<DetailTab, boolean>

type CacheInfo = {
  cachedAt: string
  latestCommitSha: string | null
}

const MetaRow = ({ label, value }: { label: string; value: string }) => (
  <div className="meta-row">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
)

const activityTypeLabel: Record<'commit' | 'issue' | 'pull_request', string> = {
  commit: 'Commit',
  issue: 'Issue',
  pull_request: 'PR',
}

type HeaderBadgeIcon = 'star' | 'fork' | 'watch'

const HeaderBadge = ({ icon, label, value }: { icon: HeaderBadgeIcon; label: string; value: number }) => {
  const pathByIcon: Record<HeaderBadgeIcon, string> = {
    star: 'M8 .75l2.114 4.283 4.729.687-3.422 3.334.808 4.71L8 11.54l-4.229 2.224.808-4.71L1.157 5.72l4.729-.687L8 .75z',
    fork: 'M5 1.5A1.5 1.5 0 1 1 5 4.5a1.5 1.5 0 0 1 0-3Zm0 0v4.1a2.4 2.4 0 0 0 1.014 1.957l3.172 2.243M10.5 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
    watch: 'M1.25 8s2.6-4.5 6.75-4.5 6.75 4.5 6.75 4.5-2.6 4.5-6.75 4.5S1.25 8 1.25 8Zm6.75 2.25A2.25 2.25 0 1 0 8 5.75a2.25 2.25 0 0 0 0 4.5Z',
  }

  return (
    <span className="header-badge" title={label}>
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d={pathByIcon[icon]} />
      </svg>
      <strong>{formatNumber(value)}</strong>
      <small>{label}</small>
    </span>
  )
}

export const RepoDetailModal = ({ repo, notes, onClose, onAddNote }: RepoDetailModalProps) => {
  const [noteInput, setNoteInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [detailData, setDetailData] = useState<RepoDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null)
  const [hasRemoteUpdate, setHasRemoteUpdate] = useState(false)
  const [updateCheckLoading, setUpdateCheckLoading] = useState(false)
  const [updateCheckMessage, setUpdateCheckMessage] = useState<string | null>(null)

  const [overviewTranslation, setOverviewTranslation] = useState<{
    description: string
    summary: string
  } | null>(null)
  const [readmeTranslation, setReadmeTranslation] = useState<string | null>(null)
  const [activityTranslationMap, setActivityTranslationMap] = useState<Record<string, string> | null>(null)
  const [translationLoading, setTranslationLoading] = useState<TranslationLoadingState>({
    overview: false,
    readme: false,
    activity: false,
  })
  const [translationError, setTranslationError] = useState<string | null>(null)

  useEffect(() => {
    if (!repo) {
      return
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, repo])

  useEffect(() => {
    if (!repo) {
      return
    }

    let cancelled = false

    const resetModalState = () => {
      setActiveTab('overview')
      setDetailError(null)
      setHasRemoteUpdate(false)
      setUpdateCheckLoading(false)
      setUpdateCheckMessage(null)
      setTranslationError(null)
      setOverviewTranslation(null)
      setReadmeTranslation(null)
      setActivityTranslationMap(null)
      setTranslationLoading({
        overview: false,
        readme: false,
        activity: false,
      })
    }

    const initDetail = async () => {
      resetModalState()

      const cached = getRepoDetailCache(repo.id)
      if (cached) {
        if (!cancelled) {
          setDetailData(cached.detail)
          setCacheInfo({
            cachedAt: cached.cachedAt,
            latestCommitSha: cached.detail.latestCommitSha ?? null,
          })
          setDetailLoading(false)
        }

        return
      }

      setDetailLoading(true)

      try {
        const detail = await fetchRepoDetail(repo.owner, repo.repo)

        if (!cancelled) {
          const cachedAt = new Date().toISOString()
          setDetailData(detail)
          setCacheInfo({
            cachedAt,
            latestCommitSha: detail.latestCommitSha ?? null,
          })
          upsertRepoDetailCache({
            repoId: repo.id,
            cachedAt,
            detail,
          })
        }
      } catch (loadError) {
        if (!cancelled) {
          setDetailData(null)
          if (loadError instanceof Error) {
            setDetailError(loadError.message)
          } else {
            setDetailError('상세 정보를 불러오지 못했습니다.')
          }
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    }

    void initDetail()

    return () => {
      cancelled = true
    }
  }, [repo])

  const readmeSource = readmeTranslation ?? detailData?.readmePreview ?? ''

  const readmeHtml = useMemo(
    () =>
      renderMarkdownToSafeHtml(readmeSource, {
        owner: repo?.owner ?? '',
        repo: repo?.repo ?? '',
        branch: repo?.defaultBranch ?? 'main',
      }),
    [readmeSource, repo?.defaultBranch, repo?.owner, repo?.repo],
  )

  if (!repo) {
    return null
  }

  const setTabLoading = (tab: DetailTab, isLoading: boolean) => {
    setTranslationLoading((current) => ({
      ...current,
      [tab]: isLoading,
    }))
  }

  const activityItems = detailData?.recentActivity ?? []
  const activityKey = (type: string, id: string) => `${type}:${id}`
  const displayedDescription = overviewTranslation?.description ?? repo.description
  const displayedSummary = overviewTranslation?.summary ?? repo.summary

  const saveDetailToCache = (detail: RepoDetailData) => {
    const cachedAt = new Date().toISOString()
    setDetailData(detail)
    setCacheInfo({
      cachedAt,
      latestCommitSha: detail.latestCommitSha ?? null,
    })

    upsertRepoDetailCache({
      repoId: repo.id,
      cachedAt,
      detail,
    })
  }

  const refreshDetailData = async () => {
    setUpdateCheckLoading(true)
    setUpdateCheckMessage(null)
    setDetailError(null)

    try {
      const detail = await fetchRepoDetail(repo.owner, repo.repo)
      saveDetailToCache(detail)
      setHasRemoteUpdate(false)
      setOverviewTranslation(null)
      setReadmeTranslation(null)
      setActivityTranslationMap(null)
      setUpdateCheckMessage('최신 데이터로 갱신했습니다.')
    } catch (refreshError) {
      if (refreshError instanceof Error) {
        setUpdateCheckMessage(refreshError.message)
      } else {
        setUpdateCheckMessage('최신 데이터 갱신에 실패했습니다.')
      }
    } finally {
      setUpdateCheckLoading(false)
    }
  }

  const handleCheckForUpdate = async () => {
    setUpdateCheckLoading(true)
    setUpdateCheckMessage(null)

    try {
      const latestCommitSha = await fetchLatestCommitSha(repo.owner, repo.repo)
      const cachedCommitSha = cacheInfo?.latestCommitSha ?? detailData?.latestCommitSha ?? null

      if (!latestCommitSha || !cachedCommitSha) {
        setHasRemoteUpdate(true)
        setUpdateCheckMessage('커밋 비교 정보가 없어 업데이트가 필요할 수 있습니다.')
        return
      }

      if (latestCommitSha === cachedCommitSha) {
        setHasRemoteUpdate(false)
        setUpdateCheckMessage('이미 최신 캐시입니다.')
      } else {
        setHasRemoteUpdate(true)
        setUpdateCheckMessage('새 커밋이 감지되었습니다. 업데이트 버튼을 눌러 반영하세요.')
      }
    } catch (checkError) {
      if (checkError instanceof Error) {
        setUpdateCheckMessage(checkError.message)
      } else {
        setUpdateCheckMessage('업데이트 확인에 실패했습니다.')
      }
    } finally {
      setUpdateCheckLoading(false)
    }
  }

  const handleTranslateOverview = async () => {
    if (overviewTranslation) {
      setOverviewTranslation(null)
      return
    }

    setTabLoading('overview', true)
    setTranslationError(null)

    try {
      const [description, summary] = await translateBatchToKorean([repo.description, repo.summary], 'plain')
      setOverviewTranslation({ description, summary })
    } catch {
      setTranslationError('개요 번역에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setTabLoading('overview', false)
    }
  }

  const handleTranslateReadme = async () => {
    if (readmeTranslation) {
      setReadmeTranslation(null)
      return
    }

    const source = detailData?.readmePreview
    if (!source) {
      return
    }

    setTabLoading('readme', true)
    setTranslationError(null)

    try {
      const translated = await translateToKorean(source, 'markdown')
      setReadmeTranslation(translated)
    } catch {
      setTranslationError('README 번역에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setTabLoading('readme', false)
    }
  }

  const handleTranslateActivity = async () => {
    if (activityTranslationMap) {
      setActivityTranslationMap(null)
      return
    }

    if (activityItems.length === 0) {
      return
    }

    setTabLoading('activity', true)
    setTranslationError(null)

    try {
      const translatedTitles = await translateBatchToKorean(
        activityItems.map((item) => item.title),
        'plain',
      )

      const nextMap: Record<string, string> = {}
      activityItems.forEach((item, index) => {
        nextMap[activityKey(item.type, item.id)] = translatedTitles[index] ?? item.title
      })

      setActivityTranslationMap(nextMap)
    } catch {
      setTranslationError('Activity 번역에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setTabLoading('activity', false)
    }
  }

  const handleSubmitNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = noteInput.trim()

    if (!content) {
      setError('메모를 입력해 주세요.')
      return
    }

    if (content.length > MAX_NOTE_LENGTH) {
      setError(`메모는 최대 ${MAX_NOTE_LENGTH}자까지 입력 가능합니다.`)
      return
    }

    onAddNote(repo.id, content)
    setNoteInput('')
    setError(null)
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="repo-modal-title">
        <header className="modal-header">
          <div>
            <h2 id="repo-modal-title">{repo.fullName}</h2>
            <p>{displayedDescription || '설명이 없습니다.'}</p>
            <div className="header-badges">
              <HeaderBadge icon="star" label="Stars" value={repo.stars} />
              <HeaderBadge icon="fork" label="Forks" value={repo.forks} />
              <HeaderBadge icon="watch" label="Watchers" value={repo.watchers} />
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="상세 팝업 닫기">
            닫기
          </button>
        </header>

        <nav className="modal-tabs" aria-label="저장소 상세 탭">
          <button
            type="button"
            className={activeTab === 'overview' ? 'active' : ''}
            onClick={() => setActiveTab('overview')}
          >
            개요
          </button>
          <button
            type="button"
            className={activeTab === 'readme' ? 'active' : ''}
            onClick={() => setActiveTab('readme')}
          >
            README
          </button>
          <button
            type="button"
            className={activeTab === 'activity' ? 'active' : ''}
            onClick={() => setActiveTab('activity')}
          >
            Activity
          </button>
        </nav>

        <div className="cache-control-row">
          <div className="cache-meta">
            {cacheInfo ? (
              <span>캐시 시각: {formatDateTime(cacheInfo.cachedAt)}</span>
            ) : (
              <span>캐시 없음</span>
            )}
          </div>
          <div className="cache-actions">
            <button type="button" className="translate-button" onClick={() => void handleCheckForUpdate()} disabled={updateCheckLoading || detailLoading}>
              {updateCheckLoading ? '확인 중...' : '업데이트 확인'}
            </button>
            {hasRemoteUpdate ? (
              <button type="button" className="translate-button" onClick={() => void refreshDetailData()} disabled={updateCheckLoading || detailLoading}>
                최신 데이터 불러오기
              </button>
            ) : null}
          </div>
        </div>

        {updateCheckMessage ? <p className="cache-message">{updateCheckMessage}</p> : null}

        <section className="tab-content" aria-live="polite">
          {detailLoading ? <p className="detail-status">상세 데이터를 불러오는 중입니다...</p> : null}
          {detailError ? <p className="inline-error">{detailError}</p> : null}
          {translationError ? <p className="inline-error">{translationError}</p> : null}

          {!detailLoading && activeTab === 'overview' ? (
            <>
              <div className="tab-action-row">
                <button
                  type="button"
                  className="translate-button"
                  onClick={() => void handleTranslateOverview()}
                  disabled={translationLoading.overview}
                >
                  {translationLoading.overview
                    ? '번역 중...'
                    : overviewTranslation
                      ? '원문 보기'
                      : '개요 번역'}
                </button>
              </div>
              <dl className="meta-grid">
                <MetaRow label="Stars" value={formatNumber(repo.stars)} />
                <MetaRow label="Forks" value={formatNumber(repo.forks)} />
                <MetaRow label="Watchers" value={formatNumber(repo.watchers)} />
                <MetaRow label="Open issues" value={formatNumber(repo.openIssues)} />
                <MetaRow label="Language" value={repo.language ?? 'N/A'} />
                <MetaRow label="License" value={repo.license ?? 'N/A'} />
                <MetaRow label="Default branch" value={repo.defaultBranch} />
                <MetaRow label="Created" value={formatDate(repo.createdAt)} />
                <MetaRow label="Updated" value={formatDate(repo.updatedAt)} />
                <MetaRow label="Topics" value={repo.topics.length ? repo.topics.join(', ') : 'N/A'} />
              </dl>

              <div className="summary-panel">
                <h3>Summary</h3>
                <p>{displayedSummary}</p>
              </div>

              <div className="detail-links">
                <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
                  GitHub에서 열기
                </a>
                {repo.homepage ? (
                  <a href={repo.homepage} target="_blank" rel="noreferrer">
                    Homepage
                  </a>
                ) : null}
              </div>
            </>
          ) : null}

          {!detailLoading && activeTab === 'readme' ? (
            <>
              <div className="tab-action-row">
                <button
                  type="button"
                  className="translate-button"
                  onClick={() => void handleTranslateReadme()}
                  disabled={translationLoading.readme || !detailData?.readmePreview}
                >
                  {translationLoading.readme
                    ? '번역 중...'
                    : readmeTranslation
                      ? '원문 보기'
                      : 'README 번역'}
                </button>
              </div>
              <div className="readme-panel">
                {readmeHtml ? (
                  <div className="readme-markdown" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
                ) : (
                  <p className="detail-status">README 미리보기를 제공할 수 없습니다.</p>
                )}
              </div>
            </>
          ) : null}

          {!detailLoading && activeTab === 'activity' ? (
            <>
              <div className="tab-action-row">
                <button
                  type="button"
                  className="translate-button"
                  onClick={() => void handleTranslateActivity()}
                  disabled={translationLoading.activity || activityItems.length === 0}
                >
                  {translationLoading.activity
                    ? '번역 중...'
                    : activityTranslationMap
                      ? '원문 보기'
                      : 'Activity 번역'}
                </button>
              </div>
              <ul className="activity-list">
                {activityItems.length ? (
                  activityItems.map((item) => (
                    <li key={`${item.type}-${item.id}`}>
                      <div className="activity-head">
                        <span className={`activity-badge ${item.type}`}>{activityTypeLabel[item.type]}</span>
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {activityTranslationMap?.[activityKey(item.type, item.id)] ?? item.title}
                        </a>
                      </div>
                      <p>
                        {item.author} · {formatDateTime(item.createdAt)}
                      </p>
                    </li>
                  ))
                ) : (
                  <li className="note-empty">최근 활동 정보가 없습니다.</li>
                )}
              </ul>
            </>
          ) : null}
        </section>

        <section className="note-section">
          <h3>아이디어 / 기록</h3>
          <form className="note-form" onSubmit={handleSubmitNote}>
            <input
              type="text"
              value={noteInput}
              onChange={(event) => setNoteInput(event.target.value)}
              placeholder="간단한 아이디어나 작업 기록을 남겨 보세요."
              maxLength={MAX_NOTE_LENGTH}
            />
            <button type="submit">입력</button>
          </form>
          <p className="note-counter">
            {noteInput.length}/{MAX_NOTE_LENGTH}
          </p>
          {error ? <p className="inline-error">{error}</p> : null}

          <ul className="note-list">
            {notes.length === 0 ? <li className="note-empty">아직 기록이 없습니다.</li> : null}
            {notes.map((note) => (
              <li key={note.id}>
                <p>{note.content}</p>
                <time dateTime={note.createdAt}>{formatDate(note.createdAt)}</time>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </div>
  )
}
