import { useEffect, useMemo, useReducer, useState } from 'react'
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
import type { GitHubRepoSearchItem } from '@features/github/services/github'
import { fetchRepo, searchPublicRepos } from '@features/github/services/github'
import { dashboardReducer, initialState } from '@features/github/state/dashboardReducer'
import {
  CARDS_PER_PAGE,
  CATEGORY_NAME_MAX_LENGTH,
  DEFAULT_MAIN_CATEGORY_ID,
} from '@constants'
import { removeRepoDetailCache } from '@storage/detailCache'
import {
  saveCards,
  saveCategories,
  saveNotes,
  saveSelectedCategoryId,
} from '@shared/storage/localStorage'
import type { Category, CategoryId, GitHubRepoCard, RepoNote, ThemeMode } from '@shared/types'
import { pageCount, paginate } from '@utils/paginate'
import { parseGitHubRepoUrl } from '@utils/parseGitHubRepoUrl'
import { buildSummary } from '@utils/summary'

type GithubFeatureEntryProps = {
  themeMode: ThemeMode
  onToggleTheme: () => void
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

const GITHUB_SEARCH_MAX_TOTAL_COUNT = 1000

const mapPublicSearchItemToCard = (item: GitHubRepoSearchItem): GitHubRepoCard => ({
  id: item.id.toLowerCase(),
  categoryId: DEFAULT_MAIN_CATEGORY_ID,
  owner: item.owner,
  repo: item.repo,
  fullName: item.fullName,
  description: item.description,
  summary: buildSummary(item.description, null),
  htmlUrl: item.htmlUrl,
  homepage: null,
  language: item.language,
  stars: item.stars,
  forks: item.forks,
  watchers: 0,
  openIssues: 0,
  topics: item.topics,
  license: null,
  defaultBranch: 'main',
  createdAt: item.updatedAt,
  updatedAt: item.updatedAt,
  addedAt: new Date().toISOString(),
})

export const GithubFeatureEntry = ({ themeMode, onToggleTheme }: GithubFeatureEntryProps) => {
  const remoteEnabled = isRemoteSnapshotEnabled()
  const [state, dispatch] = useReducer(dashboardReducer, undefined, initialState)
  const [loading, setLoading] = useState(false)
  const [hydrating, setHydrating] = useState(remoteEnabled)
  const [hasLoadedRemote, setHasLoadedRemote] = useState(!remoteEnabled)
  const [remoteSyncDegraded, setRemoteSyncDegraded] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchErrorMessage, setSearchErrorMessage] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<GitHubRepoSearchItem[]>([])
  const [searchTotalCount, setSearchTotalCount] = useState(0)
  const [searchPage, setSearchPage] = useState(1)
  const [hasSearchedPublicRepos, setHasSearchedPublicRepos] = useState(false)
  const [addingFromSearchId, setAddingFromSearchId] = useState<string | null>(null)
  const [categoryMessage, setCategoryMessage] = useState<string | null>(null)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [previewRepo, setPreviewRepo] = useState<GitHubRepoCard | null>(null)

  const selectedCategory = useMemo(
    () => state.categories.find((category) => category.id === state.selectedCategoryId) ?? null,
    [state.categories, state.selectedCategoryId],
  )

  const cardsInSelectedCategory = useMemo(
    () => state.cards.filter((card) => card.categoryId === state.selectedCategoryId),
    [state.cards, state.selectedCategoryId],
  )

  const totalPages = useMemo(() => pageCount(cardsInSelectedCategory.length, CARDS_PER_PAGE), [cardsInSelectedCategory])

  const currentCards = useMemo(
    () => paginate(cardsInSelectedCategory, state.currentPage, CARDS_PER_PAGE),
    [cardsInSelectedCategory, state.currentPage],
  )

  const selectedRepo = useMemo(
    () => state.cards.find((card) => card.id === state.selectedRepoId) ?? null,
    [state.cards, state.selectedRepoId],
  )

  const cardsById = useMemo(() => {
    return new Map(state.cards.map((card) => [card.id, card]))
  }, [state.cards])

  const searchResultCards = useMemo(
    () =>
      searchResults.map((item) => {
        const existing = cardsById.get(item.id)
        if (existing) {
          return {
            repo: existing,
            variant: 'saved' as const,
          }
        }

        return {
          repo: mapPublicSearchItemToCard(item),
          variant: 'search-unsaved' as const,
        }
      }),
    [cardsById, searchResults],
  )

  const searchTotalPages = useMemo(() => {
    const cappedTotalCount = Math.min(searchTotalCount, GITHUB_SEARCH_MAX_TOTAL_COUNT)
    return pageCount(cappedTotalCount, CARDS_PER_PAGE)
  }, [searchTotalCount])

  useEffect(() => {
    if (!remoteEnabled) {
      return
    }

    let cancelled = false

    const hydrateFromRemote = async () => {
      setHydrating(true)
      setErrorMessage(null)

      try {
        const remoteDashboard = await loadGithubDashboardFromRemote()

        if (!cancelled && remoteDashboard) {
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
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : '원격 대시보드 로딩에 실패했습니다.')
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
    if (remoteEnabled && !remoteSyncDegraded) {
      if (!hasLoadedRemote) {
        return
      }

      const payload = {
        cards: state.cards,
        notesByRepo: state.notesByRepo,
        categories: state.categories,
        selectedCategoryId: state.selectedCategoryId,
      }

      void saveGithubDashboardToRemote(payload).catch((error) => {
        saveCards(state.cards)
        saveNotes(state.notesByRepo)
        saveCategories(state.categories)
        saveSelectedCategoryId(state.selectedCategoryId)
        setRemoteSyncDegraded(true)
        setErrorMessage(
          error instanceof Error
            ? `${error.message} 로컬 저장으로 전환했습니다.`
            : '원격 대시보드 저장에 실패했습니다. 로컬 저장으로 전환했습니다.',
        )
      })
      return
    }

    saveCards(state.cards)
    saveNotes(state.notesByRepo)
    saveCategories(state.categories)
    saveSelectedCategoryId(state.selectedCategoryId)
  }, [
    hasLoadedRemote,
    remoteEnabled,
    remoteSyncDegraded,
    state.cards,
    state.categories,
    state.notesByRepo,
    state.selectedCategoryId,
  ])

  useEffect(() => {
    const maxPage = pageCount(cardsInSelectedCategory.length, CARDS_PER_PAGE)
    if (state.currentPage > maxPage) {
      dispatch({ type: 'setPage', payload: { page: maxPage } })
    }
  }, [cardsInSelectedCategory.length, state.currentPage])

  const handleSubmitRepo = async (value: string): Promise<boolean> => {
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

  const handleSearchPublicRepos = async (nextPage = 1): Promise<void> => {
    if (hydrating) {
      setSearchErrorMessage('원격 데이터를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.')
      return
    }

    if (state.selectedCategoryId !== DEFAULT_MAIN_CATEGORY_ID) {
      setSearchErrorMessage('공개 저장소 검색은 메인 카테고리에서만 가능합니다.')
      return
    }

    const normalizedQuery = searchQuery.trim()
    if (normalizedQuery.length < 2) {
      setHasSearchedPublicRepos(true)
      setSearchResults([])
      setSearchTotalCount(0)
      setSearchPage(1)
      setSearchErrorMessage('검색어는 2자 이상 입력해 주세요.')
      return
    }

    setSearchLoading(true)
    setSearchErrorMessage(null)
    setHasSearchedPublicRepos(true)

    try {
      const response = await searchPublicRepos(normalizedQuery, nextPage, CARDS_PER_PAGE)
      setSearchResults(response.items)
      setSearchTotalCount(response.totalCount)
      setSearchPage(response.page)
    } catch (error) {
      setSearchResults([])
      setSearchTotalCount(0)
      setSearchPage(1)
      setSearchErrorMessage(error instanceof Error ? error.message : '공개 저장소 검색에 실패했습니다.')
    } finally {
      setSearchLoading(false)
    }
  }

  const handleAddFromSearch = async (repoId: string): Promise<void> => {
    if (state.cards.some((card) => card.id === repoId)) {
      setSearchErrorMessage('이미 추가된 저장소입니다.')
      return
    }

    const target = searchResults.find((item) => item.id === repoId)
    if (!target) {
      setSearchErrorMessage('검색 결과를 찾을 수 없습니다. 다시 검색해 주세요.')
      return
    }

    setAddingFromSearchId(repoId)
    setSearchErrorMessage(null)

    try {
      const card = await fetchRepo(target.owner, target.repo)
      dispatch({
        type: 'addCard',
        payload: {
          ...card,
          categoryId: DEFAULT_MAIN_CATEGORY_ID,
        },
      })
      dispatch({ type: 'setPage', payload: { page: 1 } })
    } catch (error) {
      setSearchErrorMessage(
        error instanceof Error ? error.message : '검색 결과 저장소를 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      )
    } finally {
      setAddingFromSearchId(null)
    }
  }

  const handleOpenDetail = (repoId: string) => {
    const saved = state.cards.find((card) => card.id === repoId)
    if (saved) {
      setPreviewRepo(null)
      dispatch({ type: 'selectRepo', payload: { repoId } })
      return
    }

    const fromSearch = searchResults.find((item) => item.id === repoId)
    if (!fromSearch) {
      return
    }

    dispatch({ type: 'closeModal' })
    setPreviewRepo(mapPublicSearchItemToCard(fromSearch))
  }

  const handleCloseDetailModal = () => {
    setPreviewRepo(null)
    dispatch({ type: 'closeModal' })
  }

  const handleDeleteCard = (repoId: string) => {
    const target = state.cards.find((card) => card.id === repoId)
    if (!target) {
      return
    }

    if (!window.confirm(`${target.fullName} 카드를 삭제할까요?`)) {
      return
    }

    dispatch({ type: 'removeCard', payload: { repoId } })
    removeRepoDetailCache(repoId)
  }

  const handleAddNote = (repoId: string, content: string) => {
    const note: RepoNote = {
      id: createNoteId(),
      repoId,
      content,
      createdAt: new Date().toISOString(),
    }

    dispatch({ type: 'addNote', payload: note })
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
    setCategoryMessage('카테고리를 삭제하고 저장소를 창고로 이동했습니다.')
  }

  const handleMoveCard = (repoId: string, targetCategoryId: CategoryId) => {
    dispatch({
      type: 'moveCardToCategory',
      payload: {
        repoId,
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
          <RepoInputForm onSubmit={handleSubmitRepo} loading={loading || hydrating} errorMessage={errorMessage} />
          <RepoSearchForm
            value={searchQuery}
            loading={searchLoading || hydrating}
            errorMessage={searchErrorMessage}
            onChange={(value) => {
              setSearchQuery(value)
              if (searchErrorMessage) {
                setSearchErrorMessage(null)
              }
            }}
            onSubmit={async () => {
              await handleSearchPublicRepos(1)
            }}
          />
        </section>
      ) : (
        <section className="main-only-notice" aria-live="polite">
          <p>저장소 추가는 메인 카테고리에서만 가능합니다.</p>
        </section>
      )}

      {state.selectedCategoryId === DEFAULT_MAIN_CATEGORY_ID && hasSearchedPublicRepos ? (
        <section className="search-result-section" aria-live="polite">
          <header className="search-result-header">
            <h2>GitHub 공개 검색 결과</h2>
            <p>
              검색어: <strong>{searchQuery.trim() || '-'}</strong>
            </p>
          </header>

          {searchLoading ? (
            <div className="empty-state">
              <h2>검색 중...</h2>
              <p>GitHub 공개 저장소를 조회하고 있습니다.</p>
            </div>
          ) : null}

          {!searchLoading && searchResultCards.length === 0 ? (
            <div className="empty-state">
              <h2>검색 결과가 없습니다</h2>
              <p>다른 키워드로 다시 검색해 보세요.</p>
            </div>
          ) : null}

          {!searchLoading && searchResultCards.length > 0 ? (
            <>
              <div className="card-grid">
                {searchResultCards.map(({ repo, variant }) => (
                  <RepoCard
                    key={`search-${repo.id}`}
                    repo={repo}
                    variant={variant}
                    addLoading={addingFromSearchId === repo.id}
                    categories={state.categories}
                    onOpenDetail={handleOpenDetail}
                    onDelete={handleDeleteCard}
                    onMove={handleMoveCard}
                    onAddFromSearch={handleAddFromSearch}
                  />
                ))}
              </div>
              <Pagination
                currentPage={searchPage}
                totalPages={searchTotalPages}
                onChangePage={(page) => {
                  void handleSearchPublicRepos(page)
                }}
              />
            </>
          ) : null}
        </section>
      ) : null}

      <section className="card-grid-section" aria-live="polite">
        {hydrating ? (
          <div className="empty-state">
            <h2>원격 데이터 로딩 중...</h2>
            <p>PostgreSQL에서 최신 대시보드를 불러오고 있습니다.</p>
          </div>
        ) : null}

        {!hydrating && cardsInSelectedCategory.length === 0 ? (
          <div className="empty-state">
            <h2>{selectedCategory?.name ?? '현재'} 카테고리에 저장소가 없습니다</h2>
            <p>
              {state.selectedCategoryId === DEFAULT_MAIN_CATEGORY_ID
                ? '상단 입력창에 GitHub 저장소 URL을 넣고 첫 카드를 만들어 보세요.'
                : '메인에서 저장소를 추가한 뒤 이 카테고리로 이동해 보세요.'}
            </p>
          </div>
        ) : null}

        {!hydrating && cardsInSelectedCategory.length > 0 ? (
          <>
            <div className="card-grid">
              {currentCards.map((repo) => (
                <RepoCard
                  key={repo.id}
                  repo={repo}
                  categories={state.categories}
                  onOpenDetail={handleOpenDetail}
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

      <RepoDetailModal
        repo={selectedRepo ?? previewRepo}
        mode={selectedRepo ? 'saved' : previewRepo ? 'preview' : 'saved'}
        notes={selectedRepo ? state.notesByRepo[selectedRepo.id] ?? [] : []}
        onClose={handleCloseDetailModal}
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
