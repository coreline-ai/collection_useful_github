import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  isRemoteSnapshotEnabled,
  loadGithubDashboardFromRemote,
  saveGithubDashboardToRemote,
} from '@core/data/adapters/remoteDb'
import { CategorySettingsModal } from '@features/github/ui/CategorySettingsModal'
import { Pagination } from '@features/github/ui/Pagination'
import { RepoCard } from '@features/github/ui/RepoCard'
import { RepoDetailModal } from '@features/github/ui/RepoDetailModal'
import { RepoInputForm } from '@features/github/ui/RepoInputForm'
import { RepoSearchForm } from '@features/github/ui/RepoSearchForm'
import {
  fetchGithubSummaryStatus,
  fetchRepo,
  regenerateGithubSummary,
} from '@features/github/services/github'
import { dashboardReducer, initialState } from '@features/github/state/dashboardReducer'
import {
  CARDS_PER_PAGE,
  CATEGORY_NAME_MAX_LENGTH,
  DEFAULT_MAIN_CATEGORY_ID,
  REMOTE_SYNC_NETWORK_FAILURES_BEFORE_FALLBACK,
  REMOTE_SYNC_RECOVERED_BADGE_MS,
  REMOTE_SYNC_RECOVERY_INTERVAL_MS,
  REMOTE_SYNC_SAVE_DEBOUNCE_MS,
} from '@constants'
import { removeRepoDetailCache } from '@storage/detailCache'
import {
  clearGithubDashboardCache,
  saveCards,
  saveCategories,
  saveNotes,
  saveSelectedCategoryId,
} from '@shared/storage/localStorage'
import type {
  Category,
  CategoryId,
  GitHubDashboardSnapshot,
  GitHubRepoCard,
  RepoNote,
  SyncConnectionStatus,
  ThemeMode,
} from '@shared/types'
import { pageCount, paginate } from '@utils/paginate'
import { parseGitHubRepoUrl } from '@utils/parseGitHubRepoUrl'
import { isRemoteSyncConnectionWarning, isTransientRemoteSyncError } from '@utils/remoteSync'

type GithubFeatureEntryProps = {
  themeMode: ThemeMode
  onToggleTheme: () => void
  onSyncStatusChange?: (payload: { status: SyncConnectionStatus; lastSuccessAt: string | null }) => void
}

const createNoteId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

const createCategoryId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `category_${crypto.randomUUID()}`
  }

  return `category_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
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

const GITHUB_SUMMARY_POLL_INTERVAL_MS = 2000
const GITHUB_SUMMARY_MAX_FAILURES = 3

export const GithubFeatureEntry = ({ themeMode, onToggleTheme, onSyncStatusChange }: GithubFeatureEntryProps) => {
  type GithubSavePayload = Pick<
    GitHubDashboardSnapshot,
    'cards' | 'notesByRepo' | 'categories' | 'selectedCategoryId'
  >

  const remoteEnabled = isRemoteSnapshotEnabled()
  const [state, dispatch] = useReducer(
    dashboardReducer,
    { useLocalCache: !remoteEnabled },
    initialState,
  )
  const [loading, setLoading] = useState(false)
  const [hydrating, setHydrating] = useState(remoteEnabled)
  const [hasLoadedRemote, setHasLoadedRemote] = useState(!remoteEnabled)
  const [hasRemoteBaseline, setHasRemoteBaseline] = useState(!remoteEnabled)
  const [remoteSyncDegraded, setRemoteSyncDegraded] = useState(false)
  const transientRemoteSaveFailuresRef = useRef(0)
  const transientRemoteLoadFailuresRef = useRef(0)
  const [syncStatus, setSyncStatus] = useState<SyncConnectionStatus>('healthy')
  const [lastSyncSuccessAt, setLastSyncSuccessAt] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [globalWarningMessage, setGlobalWarningMessage] = useState<string | null>(null)
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [categoryMessage, setCategoryMessage] = useState<string | null>(null)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const remoteRevisionRef = useRef<number | null>(null)
  const lastCommittedSnapshotRef = useRef<GithubSavePayload | null>(null)
  const skipNextRemoteSaveRef = useRef(false)
  const saveDebounceTimeoutRef = useRef<number | null>(null)
  const saveInFlightRef = useRef(false)
  const pendingRemotePayloadRef = useRef<GithubSavePayload | null>(null)
  const summaryPollTimersRef = useRef<Map<string, number>>(new Map())
  const summaryPollFailureCountRef = useRef<Map<string, number>>(new Map())
  const cardsRef = useRef(state.cards)

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
      const repo = card.repo.toLocaleLowerCase('en-US')
      const owner = card.owner.toLocaleLowerCase('en-US')
      const fullName = card.fullName.toLocaleLowerCase('en-US')

      return (
        repo.includes(normalizedSearchQuery) ||
        owner.includes(normalizedSearchQuery) ||
        fullName.includes(normalizedSearchQuery)
      )
    })
  }, [cardsInSelectedCategory, isSearchMode, normalizedSearchQuery, state.cards])

  const effectiveVisibleCards = useMemo(
    () => (remoteEnabled && !hasRemoteBaseline ? [] : visibleCards),
    [hasRemoteBaseline, remoteEnabled, visibleCards],
  )

  const totalPages = useMemo(
    () => pageCount(effectiveVisibleCards.length, CARDS_PER_PAGE),
    [effectiveVisibleCards.length],
  )

  const currentCards = useMemo(
    () => paginate(effectiveVisibleCards, state.currentPage, CARDS_PER_PAGE),
    [effectiveVisibleCards, state.currentPage],
  )

  const selectedRepo = useMemo(
    () => state.cards.find((card) => card.id === state.selectedRepoId) ?? null,
    [state.cards, state.selectedRepoId],
  )

  const categoryNameById = useMemo(() => {
    return new Map(state.categories.map((category) => [category.id, category.name]))
  }, [state.categories])

  const readOnlyMode = remoteEnabled && (!hasRemoteBaseline || remoteSyncDegraded || hydrating)
  const readOnlyMessage = '원격 DB 연결 문제로 현재 GitHub 보드는 읽기 전용입니다. 연결 복구 후 다시 시도해 주세요.'
  const startupRetryMessage = '원격 DB 연결 준비 중입니다. 서버 준비가 완료되면 자동으로 복구됩니다.'

  useEffect(() => {
    cardsRef.current = state.cards
  }, [state.cards])

  const persistLocalSnapshot = useCallback((payload: GithubSavePayload) => {
    if (remoteEnabled) {
      return
    }

    saveCards(payload.cards)
    saveNotes(payload.notesByRepo)
    saveCategories(payload.categories)
    saveSelectedCategoryId(payload.selectedCategoryId)
  }, [remoteEnabled])

  const clearSummaryPolling = useCallback((repoId: string) => {
    const timerId = summaryPollTimersRef.current.get(repoId)
    if (typeof timerId === 'number') {
      window.clearInterval(timerId)
    }

    summaryPollTimersRef.current.delete(repoId)
    summaryPollFailureCountRef.current.delete(repoId)
  }, [])

  const startSummaryPolling = useCallback(
    (repoId: string) => {
      if (summaryPollTimersRef.current.has(repoId)) {
        return
      }

      const pollSummaryStatus = async () => {
        try {
          const summary = await fetchGithubSummaryStatus(repoId)
          summaryPollFailureCountRef.current.set(repoId, 0)
          const currentCard = cardsRef.current.find((card) => card.id === repoId)
          if (!currentCard) {
            clearSummaryPolling(repoId)
            return
          }

          const patch: Partial<
            Pick<
              GitHubRepoCard,
              'summary' | 'summaryStatus' | 'summaryProvider' | 'summaryUpdatedAt' | 'summaryError'
            >
          > = {
            summaryStatus: summary.summaryStatus,
            summaryProvider: summary.summaryProvider,
            summaryUpdatedAt: summary.summaryUpdatedAt,
            summaryError: summary.summaryError,
          }

          if (summary.summaryText && summary.summaryText.trim()) {
            patch.summary = summary.summaryText
          }

          const hasSummaryChanged =
            (typeof patch.summary === 'string' && patch.summary !== currentCard.summary) ||
            patch.summaryStatus !== currentCard.summaryStatus ||
            patch.summaryProvider !== currentCard.summaryProvider ||
            (patch.summaryUpdatedAt ?? null) !== (currentCard.summaryUpdatedAt ?? null) ||
            (patch.summaryError ?? null) !== (currentCard.summaryError ?? null)

          if (hasSummaryChanged) {
            dispatch({
              type: 'patchCardSummary',
              payload: {
                repoId,
                patch,
              },
            })
          }

          if (
            summary.summaryStatus === 'ready' ||
            summary.summaryStatus === 'failed' ||
            summary.summaryJobStatus === 'succeeded' ||
            summary.summaryJobStatus === 'failed' ||
            summary.summaryJobStatus === 'dead'
          ) {
            clearSummaryPolling(repoId)
          }
        } catch (error) {
          const failureCount = (summaryPollFailureCountRef.current.get(repoId) ?? 0) + 1
          summaryPollFailureCountRef.current.set(repoId, failureCount)

          if (failureCount >= GITHUB_SUMMARY_MAX_FAILURES) {
            dispatch({
              type: 'patchCardSummary',
              payload: {
                repoId,
                patch: {
                  summaryStatus: 'failed',
                  summaryProvider: 'glm',
                  summaryUpdatedAt: new Date().toISOString(),
                  summaryError:
                    error instanceof Error ? error.message : '요약 상태를 불러오지 못했습니다.',
                },
              },
            })
            clearSummaryPolling(repoId)
          }
        }
      }

      const intervalId = window.setInterval(() => {
        void pollSummaryStatus()
      }, GITHUB_SUMMARY_POLL_INTERVAL_MS)
      summaryPollTimersRef.current.set(repoId, intervalId)
      void pollSummaryStatus()
    },
    [clearSummaryPolling],
  )

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
          const nextRevision = await saveGithubDashboardToRemote(payload, remoteRevisionRef.current)
          if (typeof nextRevision === 'number') {
            remoteRevisionRef.current = nextRevision
          }
          lastCommittedSnapshotRef.current = payload
          clearGithubDashboardCache()

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
          transientRemoteSaveFailuresRef.current = 0
          pendingRemotePayloadRef.current = null
          const fallbackSnapshot = lastCommittedSnapshotRef.current
          if (fallbackSnapshot) {
            dispatch({
              type: 'hydrateDashboard',
              payload: {
                cards: fallbackSnapshot.cards,
                notesByRepo: fallbackSnapshot.notesByRepo,
                categories: fallbackSnapshot.categories,
                selectedCategoryId: fallbackSnapshot.selectedCategoryId,
              },
            })
          }

          setRemoteSyncDegraded(true)
          setSyncStatus('retrying')
          setErrorMessage(
            error instanceof Error
              ? `${readOnlyMessage} (${error.message})`
              : `${readOnlyMessage} (원격 저장 실패)`,
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
  }, [readOnlyMessage, remoteSyncDegraded])

  const enqueueRemoteSave = useCallback((payload: GithubSavePayload) => {
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
        const remoteDashboard = await loadGithubDashboardFromRemote()
        if (!cancelled) {
          transientRemoteLoadFailuresRef.current = 0
          setHasRemoteBaseline(true)
          setRemoteSyncDegraded(false)
          clearGithubDashboardCache()
        }

        if (!cancelled && remoteDashboard) {
          remoteRevisionRef.current =
            typeof remoteDashboard.revision === 'number' && Number.isFinite(remoteDashboard.revision)
              ? remoteDashboard.revision
              : null
          lastCommittedSnapshotRef.current = {
            cards: remoteDashboard.cards,
            notesByRepo: remoteDashboard.notesByRepo,
            categories: remoteDashboard.categories,
            selectedCategoryId: remoteDashboard.selectedCategoryId,
          }
          skipNextRemoteSaveRef.current = true
          dispatch({
            type: 'hydrateDashboard',
            payload: {
              cards: remoteDashboard.cards,
              notesByRepo: remoteDashboard.notesByRepo,
              categories: remoteDashboard.categories,
              selectedCategoryId: remoteDashboard.selectedCategoryId,
            },
          })
          setLastSyncSuccessAt(new Date().toISOString())
        }
      } catch (error) {
        if (!cancelled) {
          remoteRevisionRef.current = null
          const transientError = isTransientRemoteSyncError(error)
          if (transientError) {
            transientRemoteLoadFailuresRef.current += 1
            const failureCount = transientRemoteLoadFailuresRef.current
            if (failureCount < REMOTE_SYNC_NETWORK_FAILURES_BEFORE_FALLBACK) {
              setErrorMessage(
                `${startupRetryMessage} 자동 재시도 중입니다. (${failureCount}/${REMOTE_SYNC_NETWORK_FAILURES_BEFORE_FALLBACK})`,
              )
            } else {
              setErrorMessage(
                `${readOnlyMessage} 서버 실행/네트워크/CORS 설정을 확인해 주세요.`,
              )
            }
          } else {
            setErrorMessage(
              error instanceof Error
                ? `${readOnlyMessage} (${error.message})`
                : `${readOnlyMessage} (원격 대시보드 로딩 실패)`,
            )
          }
          setRemoteSyncDegraded(true)
          setSyncStatus('retrying')
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
    if (remoteEnabled) {
      if (!hasLoadedRemote || remoteSyncDegraded || !hasRemoteBaseline) {
        return
      }

      const payload = {
        cards: state.cards,
        notesByRepo: state.notesByRepo,
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
      notesByRepo: state.notesByRepo,
      categories: state.categories,
      selectedCategoryId: state.selectedCategoryId,
    })
  }, [
    hasLoadedRemote,
    hasRemoteBaseline,
    enqueueRemoteSave,
    persistLocalSnapshot,
    remoteEnabled,
    remoteSyncDegraded,
    state.cards,
    state.categories,
    state.notesByRepo,
    state.selectedCategoryId,
  ])

  useEffect(() => {
    const summaryPollTimers = summaryPollTimersRef.current
    const summaryPollFailures = summaryPollFailureCountRef.current

    return () => {
      if (saveDebounceTimeoutRef.current !== null) {
        window.clearTimeout(saveDebounceTimeoutRef.current)
      }

      for (const timerId of summaryPollTimers.values()) {
        window.clearInterval(timerId)
      }
      summaryPollTimers.clear()
      summaryPollFailures.clear()
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
          const remoteDashboard = await loadGithubDashboardFromRemote()
          if (cancelled) {
            return
          }

          if (remoteDashboard) {
            remoteRevisionRef.current =
              typeof remoteDashboard.revision === 'number' && Number.isFinite(remoteDashboard.revision)
                ? remoteDashboard.revision
                : null
            lastCommittedSnapshotRef.current = {
              cards: remoteDashboard.cards,
              notesByRepo: remoteDashboard.notesByRepo,
              categories: remoteDashboard.categories,
              selectedCategoryId: remoteDashboard.selectedCategoryId,
            }
            skipNextRemoteSaveRef.current = true
            dispatch({
              type: 'hydrateDashboard',
              payload: {
                cards: remoteDashboard.cards,
                notesByRepo: remoteDashboard.notesByRepo,
                categories: remoteDashboard.categories,
                selectedCategoryId: remoteDashboard.selectedCategoryId,
              },
            })
          }

          transientRemoteLoadFailuresRef.current = 0
          setHasRemoteBaseline(true)
          setRemoteSyncDegraded(false)
          setSyncStatus('recovered')
          setLastSyncSuccessAt(new Date().toISOString())
          setErrorMessage((previous) => (isRemoteSyncConnectionWarning(previous) ? null : previous))
          return
        }

        const nextRevision = await saveGithubDashboardToRemote(
          {
            cards: state.cards,
            notesByRepo: state.notesByRepo,
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
          clearGithubDashboardCache()
        }
      } catch {
        // keep read-only mode until remote read/write succeeds
      } finally {
        inFlight = false
      }
    }

    void tryRecover()
    const intervalId = window.setInterval(() => {
      void tryRecover()
    }, hasRemoteBaseline ? REMOTE_SYNC_RECOVERY_INTERVAL_MS : 2000)

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
    state.notesByRepo,
    state.selectedCategoryId,
  ])

  useEffect(() => {
    onSyncStatusChange?.({ status: syncStatus, lastSuccessAt: lastSyncSuccessAt })
  }, [lastSyncSuccessAt, onSyncStatusChange, syncStatus])

  useEffect(() => {
    const queuedRepoIds = new Set(
      state.cards
        .filter((card) => (card.summaryStatus ?? (card.summary.trim() ? 'ready' : 'idle')) === 'queued')
        .map((card) => card.id),
    )

    for (const repoId of queuedRepoIds) {
      startSummaryPolling(repoId)
    }

    for (const [repoId] of summaryPollTimersRef.current) {
      if (!queuedRepoIds.has(repoId)) {
        clearSummaryPolling(repoId)
      }
    }
  }, [clearSummaryPolling, startSummaryPolling, state.cards])

  useEffect(() => {
    const maxPage = pageCount(effectiveVisibleCards.length, CARDS_PER_PAGE)
    if (state.currentPage > maxPage) {
      dispatch({ type: 'setPage', payload: { page: maxPage } })
    }
  }, [effectiveVisibleCards.length, state.currentPage])

  const handleSubmitRepo = async (value: string): Promise<boolean> => {
    if (readOnlyMode) {
      setErrorMessage(readOnlyMessage)
      return false
    }

    if (hydrating) {
      setErrorMessage('원격 데이터를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.')
      return false
    }

    if (state.selectedCategoryId !== DEFAULT_MAIN_CATEGORY_ID) {
      setErrorMessage('저장소 추가는 메인 카테고리에서만 가능합니다.')
      return false
    }

    const parsed = parseGitHubRepoUrl(value)

    if (!parsed) {
      setErrorMessage('유효한 GitHub 저장소 URL 또는 owner/repo 형식을 입력해 주세요.')
      return false
    }

    const id = `${parsed.owner}/${parsed.repo}`.toLowerCase()

    if (state.cards.some((card) => card.id === id)) {
      setErrorMessage('이미 추가된 저장소입니다.')
      return false
    }

    setLoading(true)
    setErrorMessage(null)

    try {
      const card = await fetchRepo(parsed.owner, parsed.repo)
      const cardWithCategory = {
        ...card,
        categoryId: DEFAULT_MAIN_CATEGORY_ID,
      }

      dispatch({ type: 'addCard', payload: cardWithCategory })
      dispatch({ type: 'setPage', payload: { page: 1 } })
      return true
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('저장소 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
      }

      return false
    } finally {
      setLoading(false)
    }
  }

  const handleOpenDetail = (repoId: string) => {
    dispatch({ type: 'selectRepo', payload: { repoId } })
  }

  const handleDeleteCard = (repoId: string) => {
    if (readOnlyMode) {
      setErrorMessage(readOnlyMessage)
      return
    }

    const target = state.cards.find((card) => card.id === repoId)
    if (!target) {
      return
    }

    if (!window.confirm(`${target.fullName} 카드를 삭제할까요?`)) {
      return
    }

    dispatch({ type: 'removeCard', payload: { repoId } })
    clearSummaryPolling(repoId)
    removeRepoDetailCache(repoId)
  }

  const handleAddNote = (repoId: string, content: string) => {
    if (readOnlyMode) {
      setErrorMessage(readOnlyMessage)
      return
    }

    const note: RepoNote = {
      id: createNoteId(),
      repoId,
      content,
      createdAt: new Date().toISOString(),
    }

    dispatch({ type: 'addNote', payload: note })
  }

  const handleCreateCategory = (input: string): boolean => {
    if (readOnlyMode) {
      setCategoryMessage(readOnlyMessage)
      return false
    }

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
    if (readOnlyMode) {
      setCategoryMessage(readOnlyMessage)
      return false
    }

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
    if (readOnlyMode) {
      setCategoryMessage(readOnlyMessage)
      return
    }

    if (category.isSystem) {
      setCategoryMessage('기본 카테고리는 삭제할 수 없습니다.')
      return
    }

    dispatch({ type: 'deleteCategory', payload: { categoryId: category.id } })
    setCategoryMessage('카테고리를 삭제하고 저장소를 창고로 이동했습니다.')
  }

  const handleMoveCard = (repoId: string, targetCategoryId: CategoryId) => {
    if (readOnlyMode) {
      setErrorMessage(readOnlyMessage)
      return
    }

    dispatch({
      type: 'moveCardToCategory',
      payload: {
        repoId,
        targetCategoryId,
      },
    })
  }

  const handleRegenerateSummary = async (repoId: string) => {
    if (readOnlyMode) {
      setErrorMessage(readOnlyMessage)
      return
    }

    const target = state.cards.find((card) => card.id === repoId)
    if (!target) {
      return
    }

    setErrorMessage(null)
    setGlobalWarningMessage(null)
    dispatch({
      type: 'patchCardSummary',
      payload: {
        repoId,
        patch: {
          summaryStatus: 'queued',
          summaryProvider: 'none',
          summaryError: null,
        },
      },
    })

    try {
      const response = await regenerateGithubSummary(repoId, { force: true })
      setGlobalWarningMessage(null)
      dispatch({
        type: 'patchCardSummary',
        payload: {
          repoId,
          patch: {
            summary: response.summaryStatus === 'ready' && response.summaryText ? response.summaryText : target.summary,
            summaryStatus: response.summaryStatus,
            summaryProvider: response.summaryProvider,
            summaryUpdatedAt: response.summaryUpdatedAt,
            summaryError: response.summaryError,
          },
        },
      })

      if (
        response.summaryJobStatus === 'queued' ||
        response.summaryJobStatus === 'running' ||
        (response.summaryStatus === 'queued' && response.summaryJobStatus === 'idle')
      ) {
        startSummaryPolling(repoId)
      } else {
        clearSummaryPolling(repoId)
      }
    } catch (error) {
      const summaryErrorMessage = error instanceof Error ? error.message : '요약 재생성에 실패했습니다.'
      clearSummaryPolling(repoId)
      setGlobalWarningMessage(`요약 재생성 실패: ${summaryErrorMessage}`)
      dispatch({
        type: 'patchCardSummary',
        payload: {
          repoId,
          patch: {
            summaryStatus: 'failed',
            summaryProvider: 'glm',
            summaryUpdatedAt: new Date().toISOString(),
            summaryError: summaryErrorMessage,
          },
        },
      })
    }
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

      {readOnlyMode ? (
        <section className="main-only-notice" aria-live="polite">
          <p>{readOnlyMessage}</p>
        </section>
      ) : null}

      {globalWarningMessage ? (
        <section className="global-warning-banner" aria-live="polite" role="alert">
          <p>{globalWarningMessage}</p>
        </section>
      ) : null}

      {state.selectedCategoryId === DEFAULT_MAIN_CATEGORY_ID ? (
        <section className="repo-input-split">
          <RepoInputForm
            onSubmit={handleSubmitRepo}
            loading={loading || hydrating || readOnlyMode}
            errorMessage={errorMessage}
          />
          <RepoSearchForm
            value={localSearchQuery}
            onChange={(value) => {
              setLocalSearchQuery(value)
              dispatch({ type: 'setPage', payload: { page: 1 } })
            }}
          />
        </section>
      ) : (
        <section className="main-only-notice" aria-live="polite">
          <p>저장소 추가는 메인 카테고리에서만 가능합니다.</p>
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
            <p>PostgreSQL에서 최신 대시보드를 불러오고 있습니다.</p>
          </div>
        ) : null}

        {!hydrating && effectiveVisibleCards.length === 0 ? (
          <div className="empty-state">
            <h2>
              {remoteEnabled && !hasRemoteBaseline
                ? '원격 DB 연결 대기 중'
                : isSearchMode
                ? '검색 결과가 없습니다'
                : `${selectedCategory?.name ?? '현재'} 카테고리에 저장소가 없습니다`}
            </h2>
            <p>
              {remoteEnabled && !hasRemoteBaseline
                ? '현재는 DB 읽기 전용 모드입니다. 원격 연결 복구 후 자동으로 최신 데이터가 표시됩니다.'
                : isSearchMode
                ? '다른 키워드로 다시 검색해 보세요.'
                : state.selectedCategoryId === DEFAULT_MAIN_CATEGORY_ID
                  ? '상단 입력창에 GitHub 저장소 URL을 넣고 첫 카드를 만들어 보세요.'
                  : '메인에서 저장소를 추가한 뒤 이 카테고리로 이동해 보세요.'}
            </p>
          </div>
        ) : null}

        {!hydrating && effectiveVisibleCards.length > 0 ? (
          <>
            <div className="card-grid">
              {currentCards.map((repo) => (
                <RepoCard
                  key={repo.id}
                  repo={repo}
                  categoryName={isSearchMode ? (categoryNameById.get(repo.categoryId) ?? repo.categoryId) : null}
                  categories={state.categories}
                  readOnly={readOnlyMode}
                  onOpenDetail={handleOpenDetail}
                  onDelete={handleDeleteCard}
                  onMove={handleMoveCard}
                  onRegenerateSummary={handleRegenerateSummary}
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

      <RepoDetailModal
        repo={selectedRepo}
        notes={selectedRepo ? state.notesByRepo[selectedRepo.id] ?? [] : []}
        readOnly={readOnlyMode}
        readOnlyMessage={readOnlyMessage}
        onClose={() => dispatch({ type: 'closeModal' })}
        onAddNote={handleAddNote}
      />

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
