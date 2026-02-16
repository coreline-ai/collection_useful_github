import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  isRemoteSnapshotEnabled,
  loadBookmarkDashboardFromRemote,
  saveBookmarkDashboardToRemote,
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
  createBookmarkCardFromDraft,
  fetchBookmarkMetadata,
  parseBookmarkUrl,
} from '@features/bookmark/services/bookmark'
import { dashboardReducer, initialState } from '@features/bookmark/state/dashboardReducer'
import { BookmarkCard } from '@features/bookmark/ui/BookmarkCard'
import { BookmarkInputForm } from '@features/bookmark/ui/BookmarkInputForm'
import { BookmarkSearchForm } from '@features/bookmark/ui/BookmarkSearchForm'
import {
  saveBookmarkCards,
  saveBookmarkCategories,
  saveBookmarkSelectedCategoryId,
} from '@shared/storage/localStorage'
import type {
  BookmarkCard as BookmarkCardItem,
  BookmarkDashboardSnapshot,
  Category,
  CategoryId,
  SyncConnectionStatus,
  ThemeMode,
} from '@shared/types'
import { pageCount, paginate } from '@utils/paginate'
import { isRemoteSyncConnectionWarning, isTransientRemoteSyncError } from '@utils/remoteSync'

type BookmarkFeatureEntryProps = {
  themeMode: ThemeMode
  onToggleTheme: () => void
  onSyncStatusChange?: (payload: { status: SyncConnectionStatus; lastSuccessAt: string | null }) => void
}

type BookmarkSavePayload = Pick<BookmarkDashboardSnapshot, 'cards' | 'categories' | 'selectedCategoryId'>

const createCategoryId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `bookmark_category_${crypto.randomUUID()}`
  }

  return `bookmark_category_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
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

type DuplicateGroup = {
  key: string
  reason: 'resolved' | 'canonical' | 'content'
  cards: BookmarkCardItem[]
}

const toContentBaseUrl = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '')
      if (!url.pathname) {
        url.pathname = '/'
      }
    }
    return url.toString().replace(/\?$/, '')
  } catch {
    return null
  }
}

const normalizeText = (value: string): string => value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()

const findDuplicateGroups = (cards: BookmarkCardItem[]): DuplicateGroup[] => {
  const groupsByKey = new Map<string, DuplicateGroup>()

  cards.forEach((card) => {
    const resolvedBase = toContentBaseUrl(card.lastResolvedUrl)
    if (resolvedBase) {
      const key = `resolved:${resolvedBase}`
      const existing = groupsByKey.get(key)
      if (existing) {
        existing.cards.push(card)
      } else {
        groupsByKey.set(key, { key, reason: 'resolved', cards: [card] })
      }
    }

    const canonicalBase = toContentBaseUrl(card.canonicalUrl)
    if (canonicalBase) {
      const key = `canonical:${canonicalBase}`
      const existing = groupsByKey.get(key)
      if (existing) {
        existing.cards.push(card)
      } else {
        groupsByKey.set(key, { key, reason: 'canonical', cards: [card] })
      }
    }

    const normalizedTitle = normalizeText(card.title)
    const normalizedExcerpt = normalizeText(card.excerpt)
    if (normalizedTitle.length >= 15 && normalizedExcerpt.length >= 30) {
      const key = `content:${normalizedTitle}|${normalizedExcerpt.slice(0, 120)}`
      const existing = groupsByKey.get(key)
      if (existing) {
        existing.cards.push(card)
      } else {
        groupsByKey.set(key, { key, reason: 'content', cards: [card] })
      }
    }
  })

  const uniqueGroups = new Map<string, DuplicateGroup>()

  for (const group of groupsByKey.values()) {
    const uniqueCards = Array.from(new Map(group.cards.map((card) => [card.normalizedUrl, card])).values())
    if (uniqueCards.length < 2) {
      continue
    }

    const signature = uniqueCards
      .map((card) => card.normalizedUrl)
      .sort((left, right) => left.localeCompare(right))
      .join('|')

    if (!uniqueGroups.has(signature)) {
      uniqueGroups.set(signature, {
        ...group,
        cards: uniqueCards,
      })
    }
  }

  return Array.from(uniqueGroups.values()).sort((left, right) => right.cards.length - left.cards.length)
}

const choosePrimaryCard = (cards: BookmarkCardItem[]): BookmarkCardItem => {
  const sorted = [...cards].sort((left, right) => {
    if (left.categoryId === 'warehouse' && right.categoryId !== 'warehouse') {
      return 1
    }
    if (left.categoryId !== 'warehouse' && right.categoryId === 'warehouse') {
      return -1
    }

    const leftBroken = left.linkStatus === 'not_found' || left.linkStatus === 'error' || left.linkStatus === 'timeout'
    const rightBroken =
      right.linkStatus === 'not_found' || right.linkStatus === 'error' || right.linkStatus === 'timeout'
    if (leftBroken && !rightBroken) {
      return 1
    }
    if (!leftBroken && rightBroken) {
      return -1
    }

    const leftChecked = left.lastCheckedAt ? new Date(left.lastCheckedAt).getTime() : 0
    const rightChecked = right.lastCheckedAt ? new Date(right.lastCheckedAt).getTime() : 0
    if (leftChecked !== rightChecked) {
      return rightChecked - leftChecked
    }

    const leftAdded = new Date(left.addedAt).getTime()
    const rightAdded = new Date(right.addedAt).getTime()
    return rightAdded - leftAdded
  })

  return sorted[0]
}

export const BookmarkFeatureEntry = ({
  themeMode,
  onToggleTheme,
  onSyncStatusChange,
}: BookmarkFeatureEntryProps) => {
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
  const cardsRef = useRef(state.cards)
  const remoteRevisionRef = useRef<number | null>(null)
  const saveDebounceTimeoutRef = useRef<number | null>(null)
  const saveInFlightRef = useRef(false)
  const pendingRemotePayloadRef = useRef<BookmarkSavePayload | null>(null)

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
      const excerpt = card.excerpt.toLocaleLowerCase('en-US')
      const domain = card.domain.toLocaleLowerCase('en-US')
      const normalizedUrl = card.normalizedUrl.toLocaleLowerCase('en-US')

      return (
        title.includes(normalizedSearchQuery) ||
        excerpt.includes(normalizedSearchQuery) ||
        domain.includes(normalizedSearchQuery) ||
        normalizedUrl.includes(normalizedSearchQuery)
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

  const duplicateGroups = useMemo(() => findDuplicateGroups(state.cards), [state.cards])

  const persistLocalSnapshot = useCallback((payload: BookmarkSavePayload) => {
    saveBookmarkCards(payload.cards)
    saveBookmarkCategories(payload.categories)
    saveBookmarkSelectedCategoryId(payload.selectedCategoryId)
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
          const nextRevision = await saveBookmarkDashboardToRemote(payload, remoteRevisionRef.current)
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
                : '원격 북마크 대시보드 저장에 실패했습니다. 로컬 저장으로 전환했습니다.',
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

  const enqueueRemoteSave = useCallback((payload: BookmarkSavePayload) => {
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
    cardsRef.current = state.cards
  }, [state.cards])

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
        const remoteDashboard = await loadBookmarkDashboardFromRemote()
        if (!cancelled) {
          setHasRemoteBaseline(true)
          setRemoteSyncDegraded(false)
        }

        if (!cancelled && remoteDashboard) {
          remoteRevisionRef.current =
            typeof remoteDashboard.revision === 'number' && Number.isFinite(remoteDashboard.revision)
              ? remoteDashboard.revision
              : null
          dispatch({
            type: 'hydrateDashboard',
            payload: remoteDashboard,
          })
          setLastSyncSuccessAt(new Date().toISOString())
        }
      } catch (error) {
        if (!cancelled) {
          remoteRevisionRef.current = null
          setErrorMessage(error instanceof Error ? error.message : '원격 북마크 대시보드 로딩에 실패했습니다.')
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
          const remoteDashboard = await loadBookmarkDashboardFromRemote()
          if (cancelled) {
            return
          }

          if (remoteDashboard) {
            remoteRevisionRef.current =
              typeof remoteDashboard.revision === 'number' && Number.isFinite(remoteDashboard.revision)
                ? remoteDashboard.revision
                : null
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

        const nextRevision = await saveBookmarkDashboardToRemote(
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

  const handleSubmitBookmark = async (value: string): Promise<boolean> => {
    if (hydrating) {
      setErrorMessage('원격 데이터를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.')
      return false
    }

    if (state.selectedCategoryId !== DEFAULT_MAIN_CATEGORY_ID) {
      setErrorMessage('북마크 추가는 메인 카테고리에서만 가능합니다.')
      return false
    }

    const parsed = parseBookmarkUrl(value)

    if (!parsed) {
      setErrorMessage('유효한 URL(http/https)을 입력해 주세요.')
      return false
    }

    if (state.cards.some((card) => card.normalizedUrl === parsed.normalizedUrl)) {
      setErrorMessage('이미 추가된 북마크입니다.')
      return false
    }

    setLoading(true)
    setErrorMessage(null)

    try {
      const draft = await fetchBookmarkMetadata(parsed.normalizedUrl)
      const card = createBookmarkCardFromDraft(draft)

      if (cardsRef.current.some((existingCard) => existingCard.normalizedUrl === card.normalizedUrl)) {
        setErrorMessage('이미 추가된 북마크입니다.')
        return false
      }

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
      setErrorMessage(error instanceof Error ? error.message : '북마크 메타데이터를 불러오지 못했습니다.')
      return false
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteCard = (normalizedUrl: string) => {
    const target = state.cards.find((card) => card.normalizedUrl === normalizedUrl)

    if (!target) {
      return
    }

    if (!window.confirm(`${target.title} 카드를 삭제할까요?`)) {
      return
    }

    dispatch({ type: 'removeCard', payload: { normalizedUrl } })
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
    setCategoryMessage('카테고리를 삭제하고 북마크를 창고로 이동했습니다.')
  }

  const handleMoveCard = (normalizedUrl: string, targetCategoryId: CategoryId) => {
    dispatch({
      type: 'moveCardToCategory',
      payload: {
        normalizedUrl,
        targetCategoryId,
      },
    })
  }

  const handleMergeDuplicateGroup = (group: DuplicateGroup) => {
    const primary = choosePrimaryCard(group.cards)
    const targets = group.cards.filter((card) => card.normalizedUrl !== primary.normalizedUrl)

    if (targets.length === 0) {
      return
    }

    if (
      !window.confirm(
        `중복 카드 ${targets.length}개를 정리할까요?\n유지 카드: ${primary.title} (${primary.normalizedUrl})`,
      )
    ) {
      return
    }

    targets.forEach((target) => {
      dispatch({ type: 'removeCard', payload: { normalizedUrl: target.normalizedUrl } })
    })

    setErrorMessage(null)
    setCategoryMessage(`중복 카드 ${targets.length}개를 정리했습니다.`)
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
          <BookmarkInputForm
            onSubmit={handleSubmitBookmark}
            loading={loading || hydrating}
            errorMessage={errorMessage}
          />
          <BookmarkSearchForm
            value={localSearchQuery}
            onChange={(value) => {
              setLocalSearchQuery(value)
              dispatch({ type: 'setPage', payload: { page: 1 } })
            }}
          />
        </section>
      ) : (
        <section className="main-only-notice" aria-live="polite">
          <p>북마크 추가는 메인 카테고리에서만 가능합니다.</p>
        </section>
      )}

      {isSearchMode ? (
        <section className="local-search-notice" aria-live="polite">
          <p>검색 중에는 전체 카테고리 카드에서 결과를 표시합니다.</p>
        </section>
      ) : null}

      {!hydrating && visibleCards.length > 0 ? (
        <section className="bookmark-tools-bar" aria-live="polite">
          {duplicateGroups.length > 0 ? (
            <span className="bookmark-duplicate-count">
              중복 의심 그룹 {duplicateGroups.length}개
            </span>
          ) : (
            <span className="bookmark-duplicate-count">중복 의심 그룹 없음</span>
          )}
        </section>
      ) : null}

      {!hydrating && duplicateGroups.length > 0 ? (
        <section className="bookmark-duplicate-panel" aria-label="중복 정리 도우미">
          <h3>중복 정리 도우미</h3>
          <div className="bookmark-duplicate-list">
            {duplicateGroups.map((group) => {
              const primary = choosePrimaryCard(group.cards)
              const reasonLabel =
                group.reason === 'resolved' ? '리다이렉트 최종 URL' : group.reason === 'canonical' ? 'canonical URL' : '내용 유사'

              return (
                <article key={group.key} className="bookmark-duplicate-item">
                  <div>
                    <strong>{reasonLabel}</strong>
                    <p>{group.cards.length}개 카드가 같은 콘텐츠로 추정됩니다.</p>
                    <p className="bookmark-duplicate-primary">
                      유지 추천: {primary.title}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="bookmark-tool-button"
                    onClick={() => handleMergeDuplicateGroup(group)}
                  >
                    중복 병합
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      <section className="card-grid-section" aria-live="polite">
        {hydrating ? (
          <div className="empty-state">
            <h2>원격 데이터 로딩 중...</h2>
            <p>PostgreSQL에서 최신 북마크 대시보드를 불러오고 있습니다.</p>
          </div>
        ) : null}

        {!hydrating && visibleCards.length === 0 ? (
          <div className="empty-state">
            <h2>
              {isSearchMode
                ? '검색 결과가 없습니다'
                : `${selectedCategory?.name ?? '현재'} 카테고리에 북마크가 없습니다`}
            </h2>
            <p>
              {isSearchMode
                ? '다른 키워드로 다시 검색해 보세요.'
                : state.selectedCategoryId === DEFAULT_MAIN_CATEGORY_ID
                  ? '상단 입력창에 URL을 넣고 첫 북마크 카드를 만들어 보세요.'
                  : '메인에서 북마크를 추가한 뒤 이 카테고리로 이동해 보세요.'}
            </p>
          </div>
        ) : null}

        {!hydrating && visibleCards.length > 0 ? (
          <>
            <div className="card-grid">
              {currentCards.map((card) => (
                <BookmarkCard
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
