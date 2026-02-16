import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  isRemoteSnapshotEnabled,
  loadYoutubeDashboardFromRemote,
  saveYoutubeDashboardToRemote,
} from '@core/data/adapters/remoteDb'
import {
  CATEGORY_NAME_MAX_LENGTH,
  CARDS_PER_PAGE,
  DEFAULT_MAIN_CATEGORY_ID,
  REMOTE_SYNC_NETWORK_FAILURES_BEFORE_FALLBACK,
  REMOTE_SYNC_RECOVERED_BADGE_MS,
  REMOTE_SYNC_RECOVERY_INTERVAL_MS,
  REMOTE_SYNC_SAVE_DEBOUNCE_MS,
} from '@constants'
import { CategorySettingsModal } from '@features/github/ui/CategorySettingsModal'
import { Pagination } from '@features/github/ui/Pagination'
import {
  fetchYouTubeVideo,
  parseYouTubeVideoUrl,
} from '@features/youtube/services/youtube'
import { dashboardReducer, initialState } from '@features/youtube/state/dashboardReducer'
import { YoutubeCard } from '@features/youtube/ui/YoutubeCard'
import { YoutubeInputForm } from '@features/youtube/ui/YoutubeInputForm'
import { YoutubeSearchForm } from '@features/youtube/ui/YoutubeSearchForm'
import {
  saveYoutubeCards,
  saveYoutubeCategories,
  saveYoutubeSelectedCategoryId,
} from '@shared/storage/localStorage'
import type { Category, CategoryId, SyncConnectionStatus, ThemeMode, YouTubeDashboardSnapshot } from '@shared/types'
import { pageCount, paginate } from '@utils/paginate'
import { isRemoteSyncConnectionWarning, isTransientRemoteSyncError } from '@utils/remoteSync'

type YoutubeFeatureEntryProps = {
  themeMode: ThemeMode
  onToggleTheme: () => void
  onSyncStatusChange?: (payload: { status: SyncConnectionStatus; lastSuccessAt: string | null }) => void
}

type YoutubeSavePayload = Pick<YouTubeDashboardSnapshot, 'cards' | 'categories' | 'selectedCategoryId'>

const createCategoryId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `youtube_category_${crypto.randomUUID()}`
  }

  return `youtube_category_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

const normalizeCategoryName = (value: string): string => value.trim().replace(/\s+/g, ' ')

const hasDuplicateCategoryName = (
  categories: Category[],
  name: string,
  excludingCategoryId?: string,
): boolean => {
  const normalized = name.toLocaleLowerCase('ko-KR')

  return categories.some((category) => {
    if (excludingCategoryId && category.id === excludingCategoryId) {
      return false
    }

    return category.name.toLocaleLowerCase('ko-KR') === normalized
  })
}

export const YoutubeFeatureEntry = ({ themeMode, onToggleTheme, onSyncStatusChange }: YoutubeFeatureEntryProps) => {
  const remoteEnabled = isRemoteSnapshotEnabled()
  const [state, dispatch] = useReducer(dashboardReducer, undefined, initialState)
  const [loading, setLoading] = useState(false)
  const [hydrating, setHydrating] = useState(remoteEnabled)
  const [hasLoadedRemote, setHasLoadedRemote] = useState(!remoteEnabled)
  const [hasRemoteBaseline, setHasRemoteBaseline] = useState(!remoteEnabled)
  const [remoteSyncDegraded, setRemoteSyncDegraded] = useState(false)
  const transientRemoteSaveFailuresRef = useRef(0)
  const [syncStatus, setSyncStatus] = useState<SyncConnectionStatus>('healthy')
  const [lastSyncSuccessAt, setLastSyncSuccessAt] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [categoryMessage, setCategoryMessage] = useState<string | null>(null)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const remoteRevisionRef = useRef<number | null>(null)
  const skipNextRemoteSaveRef = useRef(false)
  const saveDebounceTimeoutRef = useRef<number | null>(null)
  const saveInFlightRef = useRef(false)
  const pendingRemotePayloadRef = useRef<YoutubeSavePayload | null>(null)

  const selectedCategory = useMemo(
    () => state.categories.find((category) => category.id === state.selectedCategoryId) ?? null,
    [state.categories, state.selectedCategoryId],
  )

  const cardsInSelectedCategory = useMemo(
    () => state.cards.filter((card) => card.categoryId === state.selectedCategoryId),
    [state.cards, state.selectedCategoryId],
  )

  const normalizedSearchQuery = localSearchQuery.trim().toLocaleLowerCase('en-US')
  const isSearchMode =
    state.selectedCategoryId === DEFAULT_MAIN_CATEGORY_ID && normalizedSearchQuery.length > 0

  const visibleCards = useMemo(() => {
    if (!isSearchMode) {
      return cardsInSelectedCategory
    }

    return state.cards.filter((card) => {
      const title = card.title.toLocaleLowerCase('en-US')
      const channel = card.channelTitle.toLocaleLowerCase('en-US')
      const videoId = card.videoId.toLocaleLowerCase('en-US')

      return (
        title.includes(normalizedSearchQuery) ||
        channel.includes(normalizedSearchQuery) ||
        videoId.includes(normalizedSearchQuery)
      )
    })
  }, [cardsInSelectedCategory, isSearchMode, normalizedSearchQuery, state.cards])

  const totalPages = useMemo(() => pageCount(visibleCards.length, CARDS_PER_PAGE), [visibleCards.length])

  const currentCards = useMemo(
    () => paginate(visibleCards, state.currentPage, CARDS_PER_PAGE),
    [state.currentPage, visibleCards],
  )

  const categoryNameById = useMemo(() => {
    return new Map(state.categories.map((category) => [category.id, category.name]))
  }, [state.categories])

  const persistLocalSnapshot = useCallback((payload: YoutubeSavePayload) => {
    saveYoutubeCards(payload.cards)
    saveYoutubeCategories(payload.categories)
    saveYoutubeSelectedCategoryId(payload.selectedCategoryId)
  }, [])

  const flushRemoteSaveQueue = useCallback(async () => {
    if (saveInFlightRef.current || !pendingRemotePayloadRef.current) {
      return
    }

    saveInFlightRef.current = true

    try {
      while (pendingRemotePayloadRef.current) {
        const payload = pendingRemotePayloadRef.current
        pendingRemotePayloadRef.current = null

        try {
          const nextRevision = await saveYoutubeDashboardToRemote(payload, remoteRevisionRef.current)
          if (typeof nextRevision === 'number') {
            remoteRevisionRef.current = nextRevision
          }

          if (transientRemoteSaveFailuresRef.current > 0) {
            transientRemoteSaveFailuresRef.current = 0
            setSyncStatus('recovered')
            setLastSyncSuccessAt(new Date().toISOString())
            setErrorMessage((previous) =>
              previous?.startsWith('원격 저장 연결이 불안정합니다.') ? null : previous,
            )
            continue
          }

          if (!remoteSyncDegraded) {
            setSyncStatus('healthy')
            setLastSyncSuccessAt(new Date().toISOString())
          }
        } catch (error) {
          persistLocalSnapshot(payload)

          const statusValue =
            error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
          const statusCode = typeof statusValue === 'number' ? Number(statusValue) : null

          if (statusCode === 409) {
            transientRemoteSaveFailuresRef.current = 0
            remoteRevisionRef.current = null
            pendingRemotePayloadRef.current = null
            setHasRemoteBaseline(false)
            setRemoteSyncDegraded(true)
            setSyncStatus('retrying')
            setErrorMessage('원격 대시보드 버전 충돌이 발생해 다시 동기화 중입니다.')
            break
          }

          const transientError = isTransientRemoteSyncError(error)

          if (transientError) {
            transientRemoteSaveFailuresRef.current += 1
            if (transientRemoteSaveFailuresRef.current < REMOTE_SYNC_NETWORK_FAILURES_BEFORE_FALLBACK) {
              setSyncStatus('retrying')
              setErrorMessage(
                `원격 저장 연결이 불안정합니다. 자동 재시도 중입니다. (${transientRemoteSaveFailuresRef.current}/${REMOTE_SYNC_NETWORK_FAILURES_BEFORE_FALLBACK})`,
              )
              continue
            }
          }

          transientRemoteSaveFailuresRef.current = 0
          pendingRemotePayloadRef.current = null
          setRemoteSyncDegraded(true)
          setSyncStatus('local')
          setErrorMessage(
            transientError
              ? '원격 저장 연결이 계속 실패해 로컬 저장으로 전환했습니다. 서버 실행/네트워크/CORS 설정을 확인해 주세요.'
              : error instanceof Error
                ? `${error.message} 로컬 저장으로 전환했습니다.`
                : '원격 유튜브 대시보드 저장에 실패했습니다. 로컬 저장으로 전환했습니다.',
          )
          break
        }
      }
    } finally {
      saveInFlightRef.current = false
      if (pendingRemotePayloadRef.current) {
        void flushRemoteSaveQueue()
      }
    }
  }, [persistLocalSnapshot, remoteSyncDegraded])

  const enqueueRemoteSave = useCallback((payload: YoutubeSavePayload) => {
    pendingRemotePayloadRef.current = payload

    if (saveDebounceTimeoutRef.current !== null) {
      window.clearTimeout(saveDebounceTimeoutRef.current)
    }

    saveDebounceTimeoutRef.current = window.setTimeout(() => {
      saveDebounceTimeoutRef.current = null
      void flushRemoteSaveQueue()
    }, REMOTE_SYNC_SAVE_DEBOUNCE_MS)
  }, [flushRemoteSaveQueue])

  useEffect(() => {
    if (!remoteEnabled) {
      return
    }

    if (syncStatus !== 'recovered') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSyncStatus('healthy')
    }, REMOTE_SYNC_RECOVERED_BADGE_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [remoteEnabled, syncStatus])

  useEffect(() => {
    if (!remoteEnabled) {
      return
    }

    let cancelled = false

    const hydrateFromRemote = async () => {
      setHydrating(true)
      setErrorMessage(null)
      setSyncStatus('healthy')

      try {
        const remoteDashboard = await loadYoutubeDashboardFromRemote()
        if (!cancelled) {
          setHasRemoteBaseline(true)
          setRemoteSyncDegraded(false)
        }

        if (!cancelled && remoteDashboard) {
          remoteRevisionRef.current =
            typeof remoteDashboard.revision === 'number' && Number.isFinite(remoteDashboard.revision)
              ? remoteDashboard.revision
              : null
          skipNextRemoteSaveRef.current = true
          dispatch({
            type: 'hydrateDashboard',
            payload: remoteDashboard,
          })
          setLastSyncSuccessAt(new Date().toISOString())
        }
      } catch (error) {
        if (!cancelled) {
          remoteRevisionRef.current = null
          setErrorMessage(error instanceof Error ? error.message : '원격 유튜브 대시보드 로딩에 실패했습니다.')
          setRemoteSyncDegraded(true)
          setSyncStatus('local')
        }
      } finally {
        if (!cancelled) {
          setHydrating(false)
          setHasLoadedRemote(true)
        }
      }
    }

    void hydrateFromRemote()

    return () => {
      cancelled = true
    }
  }, [remoteEnabled])

  useEffect(() => {
    if (remoteEnabled && !remoteSyncDegraded && hasRemoteBaseline) {
      if (!hasLoadedRemote) {
        return
      }

      const payload = {
        cards: state.cards,
        categories: state.categories,
        selectedCategoryId: state.selectedCategoryId,
      }

      if (skipNextRemoteSaveRef.current) {
        skipNextRemoteSaveRef.current = false
        persistLocalSnapshot(payload)
        return
      }

      persistLocalSnapshot(payload)
      enqueueRemoteSave(payload)
      return
    }

    persistLocalSnapshot({
      cards: state.cards,
      categories: state.categories,
      selectedCategoryId: state.selectedCategoryId,
    })
  }, [
    enqueueRemoteSave,
    hasLoadedRemote,
    hasRemoteBaseline,
    persistLocalSnapshot,
    remoteEnabled,
    remoteSyncDegraded,
    state.cards,
    state.categories,
    state.selectedCategoryId,
  ])

  useEffect(() => {
    return () => {
      if (saveDebounceTimeoutRef.current !== null) {
        window.clearTimeout(saveDebounceTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!remoteEnabled || !remoteSyncDegraded || !hasLoadedRemote) {
      return
    }

    let cancelled = false
    let inFlight = false

    const tryRecover = async () => {
      if (cancelled || inFlight) {
        return
      }

      inFlight = true

      try {
        if (!hasRemoteBaseline) {
          const remoteDashboard = await loadYoutubeDashboardFromRemote()
          if (cancelled) {
            return
          }

          if (remoteDashboard) {
            remoteRevisionRef.current =
              typeof remoteDashboard.revision === 'number' && Number.isFinite(remoteDashboard.revision)
                ? remoteDashboard.revision
                : null
            skipNextRemoteSaveRef.current = true
            dispatch({
              type: 'hydrateDashboard',
              payload: remoteDashboard,
            })
          }

          setHasRemoteBaseline(true)
          setRemoteSyncDegraded(false)
          setSyncStatus('recovered')
          setLastSyncSuccessAt(new Date().toISOString())
          setErrorMessage((previous) => (isRemoteSyncConnectionWarning(previous) ? null : previous))
          return
        }

        const nextRevision = await saveYoutubeDashboardToRemote(
          {
            cards: state.cards,
            categories: state.categories,
            selectedCategoryId: state.selectedCategoryId,
          },
          remoteRevisionRef.current,
        )

        if (!cancelled) {
          if (typeof nextRevision === 'number') {
            remoteRevisionRef.current = nextRevision
          }
          transientRemoteSaveFailuresRef.current = 0
          setRemoteSyncDegraded(false)
          setSyncStatus('recovered')
          setLastSyncSuccessAt(new Date().toISOString())
          setErrorMessage((previous) => (isRemoteSyncConnectionWarning(previous) ? null : previous))
        }
      } catch {
        // keep local fallback until remote read/write succeeds
      } finally {
        inFlight = false
      }
    }

    void tryRecover()
    const intervalId = window.setInterval(() => {
      void tryRecover()
    }, REMOTE_SYNC_RECOVERY_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [
    hasLoadedRemote,
    hasRemoteBaseline,
    remoteEnabled,
    remoteSyncDegraded,
    state.cards,
    state.categories,
    state.selectedCategoryId,
  ])

  useEffect(() => {
    onSyncStatusChange?.({ status: syncStatus, lastSuccessAt: lastSyncSuccessAt })
  }, [lastSyncSuccessAt, onSyncStatusChange, syncStatus])

  useEffect(() => {
    const maxPage = pageCount(visibleCards.length, CARDS_PER_PAGE)
    if (state.currentPage > maxPage) {
      dispatch({ type: 'setPage', payload: { page: maxPage } })
    }
  }, [state.currentPage, visibleCards.length])

  const handleSubmitVideo = async (value: string): Promise<boolean> => {
    if (hydrating) {
      setErrorMessage('원격 데이터를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.')
      return false
    }

    if (state.selectedCategoryId !== DEFAULT_MAIN_CATEGORY_ID) {
      setErrorMessage('영상 추가는 메인 카테고리에서만 가능합니다.')
      return false
    }

    const parsed = parseYouTubeVideoUrl(value)

    if (!parsed) {
      setErrorMessage('유효한 YouTube 영상 URL(watch/youtu.be/shorts)을 입력해 주세요.')
      return false
    }

    if (state.cards.some((card) => card.videoId === parsed.videoId)) {
      setErrorMessage('이미 추가된 영상입니다.')
      return false
    }

    setLoading(true)
    setErrorMessage(null)

    try {
      const card = await fetchYouTubeVideo(parsed.videoId)
      dispatch({
        type: 'addCard',
        payload: {
          ...card,
          categoryId: DEFAULT_MAIN_CATEGORY_ID,
        },
      })
      dispatch({ type: 'setPage', payload: { page: 1 } })
      return true
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '영상 정보를 불러오지 못했습니다.')
      return false
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteCard = (videoId: string) => {
    const target = state.cards.find((card) => card.id === videoId)

    if (!target) {
      return
    }

    if (!window.confirm(`${target.title} 카드를 삭제할까요?`)) {
      return
    }

    dispatch({ type: 'removeCard', payload: { videoId } })
  }

  const handleCreateCategory = (input: string): boolean => {
    const name = normalizeCategoryName(input)

    if (!name) {
      setCategoryMessage('카테고리 이름을 입력해 주세요.')
      return false
    }

    if (name.length > CATEGORY_NAME_MAX_LENGTH) {
      setCategoryMessage(`카테고리 이름은 최대 ${CATEGORY_NAME_MAX_LENGTH}자까지 가능합니다.`)
      return false
    }

    if (hasDuplicateCategoryName(state.categories, name)) {
      setCategoryMessage('이미 존재하는 카테고리 이름입니다.')
      return false
    }

    dispatch({
      type: 'createCategory',
      payload: {
        category: {
          id: createCategoryId(),
          name,
          isSystem: false,
          createdAt: new Date().toISOString(),
        },
      },
    })

    setCategoryMessage('카테고리를 생성했습니다.')
    return true
  }

  const handleRenameCategory = (category: Category, input: string): boolean => {
    const name = normalizeCategoryName(input)

    if (!name) {
      setCategoryMessage('카테고리 이름을 입력해 주세요.')
      return false
    }

    if (name.length > CATEGORY_NAME_MAX_LENGTH) {
      setCategoryMessage(`카테고리 이름은 최대 ${CATEGORY_NAME_MAX_LENGTH}자까지 가능합니다.`)
      return false
    }

    if (hasDuplicateCategoryName(state.categories, name, category.id)) {
      setCategoryMessage('이미 존재하는 카테고리 이름입니다.')
      return false
    }

    dispatch({ type: 'renameCategory', payload: { categoryId: category.id, name } })
    setCategoryMessage('카테고리 이름을 변경했습니다.')
    return true
  }

  const handleDeleteCategory = (category: Category) => {
    if (category.isSystem) {
      setCategoryMessage('기본 카테고리는 삭제할 수 없습니다.')
      return
    }

    dispatch({ type: 'deleteCategory', payload: { categoryId: category.id } })
    setCategoryMessage('카테고리를 삭제하고 영상을 창고로 이동했습니다.')
  }

  const handleMoveCard = (videoId: string, targetCategoryId: CategoryId) => {
    dispatch({
      type: 'moveCardToCategory',
      payload: {
        videoId,
        targetCategoryId,
      },
    })
  }

  return (
    <>
      <section className="category-section" aria-label="카테고리 영역">
        <div className="category-tabs">
          {state.categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={category.id === state.selectedCategoryId ? 'active' : ''}
              onClick={() => {
                dispatch({ type: 'selectCategory', payload: { categoryId: category.id } })
                setCategoryMessage(null)
              }}
            >
              {category.name}
            </button>
          ))}

          <div className="category-settings">
            <button
              type="button"
              className="theme-toggle"
              onClick={onToggleTheme}
              aria-label={themeMode === 'light' ? '다크 테마 켜기' : '라이트 테마 켜기'}
              title={themeMode === 'light' ? '다크 테마 켜기' : '라이트 테마 켜기'}
            >
              {themeMode === 'light' ? '🌙' : '☀'}
            </button>
            <button
              type="button"
              className="settings-trigger"
              onClick={() => {
                setCategoryMessage(null)
                setIsCategoryModalOpen(true)
              }}
              aria-label="카테고리 설정"
            >
              ⚙
            </button>
          </div>
        </div>

      {categoryMessage && !isCategoryModalOpen ? <p className="category-message">{categoryMessage}</p> : null}
      </section>

      {state.selectedCategoryId === DEFAULT_MAIN_CATEGORY_ID ? (
        <section className="repo-input-split">
          <YoutubeInputForm
            onSubmit={handleSubmitVideo}
            loading={loading || hydrating}
            errorMessage={errorMessage}
          />
          <YoutubeSearchForm
            value={localSearchQuery}
            onChange={(value) => {
              setLocalSearchQuery(value)
              dispatch({ type: 'setPage', payload: { page: 1 } })
            }}
          />
        </section>
      ) : (
        <section className="main-only-notice" aria-live="polite">
          <p>영상 추가는 메인 카테고리에서만 가능합니다.</p>
        </section>
      )}

      {isSearchMode ? (
        <section className="local-search-notice" aria-live="polite">
          <p>검색 중에는 전체 카테고리 카드에서 결과를 표시합니다.</p>
        </section>
      ) : null}

      <section className="card-grid-section" aria-live="polite">
        {hydrating ? (
          <div className="empty-state">
            <h2>원격 데이터 로딩 중...</h2>
            <p>PostgreSQL에서 최신 유튜브 대시보드를 불러오고 있습니다.</p>
          </div>
        ) : null}

        {!hydrating && visibleCards.length === 0 ? (
          <div className="empty-state">
            <h2>
              {isSearchMode
                ? '검색 결과가 없습니다'
                : `${selectedCategory?.name ?? '현재'} 카테고리에 영상이 없습니다`}
            </h2>
            <p>
              {isSearchMode
                ? '다른 키워드로 다시 검색해 보세요.'
                : state.selectedCategoryId === DEFAULT_MAIN_CATEGORY_ID
                  ? '상단 입력창에 YouTube 영상 URL을 넣고 첫 카드를 만들어 보세요.'
                  : '메인에서 영상을 추가한 뒤 이 카테고리로 이동해 보세요.'}
            </p>
          </div>
        ) : null}

        {!hydrating && visibleCards.length > 0 ? (
          <>
            <div className="card-grid">
              {currentCards.map((card) => (
                <YoutubeCard
                  key={card.id}
                  card={card}
                  categoryName={isSearchMode ? (categoryNameById.get(card.categoryId) ?? card.categoryId) : null}
                  categories={state.categories}
                  onDelete={handleDeleteCard}
                  onMove={handleMoveCard}
                />
              ))}
            </div>
            <Pagination
              currentPage={state.currentPage}
              totalPages={totalPages}
              onChangePage={(page) => dispatch({ type: 'setPage', payload: { page } })}
            />
          </>
        ) : null}
      </section>

      <CategorySettingsModal
        open={isCategoryModalOpen}
        categories={state.categories}
        maxNameLength={CATEGORY_NAME_MAX_LENGTH}
        message={categoryMessage}
        onClose={() => setIsCategoryModalOpen(false)}
        onCreateCategory={handleCreateCategory}
        onRenameCategory={handleRenameCategory}
        onDeleteCategory={handleDeleteCategory}
      />
    </>
  )
}
