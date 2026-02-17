import { DEFAULT_MAIN_CATEGORY_ID, DEFAULT_WAREHOUSE_CATEGORY_ID } from '@constants'
import {
  loadCards,
  loadCategories,
  loadNotes,
  loadSelectedCategoryId,
} from '@shared/storage/localStorage'
import type { Category, CategoryId, GitHubRepoCard, NotesByRepo, RepoNote } from '@shared/types'

const createSystemCategory = (id: CategoryId, name: string): Category => ({
  id,
  name,
  isSystem: true,
  createdAt: new Date().toISOString(),
})

const ensureCategories = (rawCategories: Category[]): Category[] => {
  const categoriesById = new Map<string, Category>()

  rawCategories.forEach((category) => {
    if (!category?.id || !category?.name) {
      return
    }

    categoriesById.set(category.id, {
      ...category,
      createdAt: category.createdAt || new Date().toISOString(),
    })
  })

  const main = categoriesById.get(DEFAULT_MAIN_CATEGORY_ID)
  const warehouse = categoriesById.get(DEFAULT_WAREHOUSE_CATEGORY_ID)

  categoriesById.set(
    DEFAULT_MAIN_CATEGORY_ID,
    main
      ? {
          ...main,
          isSystem: true,
        }
      : createSystemCategory(DEFAULT_MAIN_CATEGORY_ID, '메인'),
  )

  categoriesById.set(
    DEFAULT_WAREHOUSE_CATEGORY_ID,
    warehouse
      ? {
          ...warehouse,
          isSystem: true,
        }
      : createSystemCategory(DEFAULT_WAREHOUSE_CATEGORY_ID, '창고'),
  )

  const systemFirst: Category[] = [
    categoriesById.get(DEFAULT_MAIN_CATEGORY_ID)!,
    categoriesById.get(DEFAULT_WAREHOUSE_CATEGORY_ID)!,
  ]

  const customCategories = Array.from(categoriesById.values()).filter(
    (category) => category.id !== DEFAULT_MAIN_CATEGORY_ID && category.id !== DEFAULT_WAREHOUSE_CATEGORY_ID,
  )

  return [...systemFirst, ...customCategories]
}

const migrateCards = (cards: GitHubRepoCard[], categories: Category[]): GitHubRepoCard[] => {
  const validCategoryIds = new Set(categories.map((category) => category.id))

  return cards.map((card) => ({
    ...card,
    categoryId: validCategoryIds.has(card.categoryId) ? card.categoryId : DEFAULT_MAIN_CATEGORY_ID,
    summaryStatus:
      card.summaryStatus === 'queued' ||
      card.summaryStatus === 'ready' ||
      card.summaryStatus === 'failed'
        ? card.summaryStatus
        : String(card.summary || '').trim()
          ? 'ready'
          : 'idle',
    summaryProvider: card.summaryProvider === 'glm' ? 'glm' : 'none',
    summaryUpdatedAt: card.summaryUpdatedAt || null,
    summaryError: card.summaryError || null,
  }))
}

export type DashboardState = {
  cards: GitHubRepoCard[]
  notesByRepo: NotesByRepo
  categories: Category[]
  selectedCategoryId: CategoryId
  currentPage: number
  selectedRepoId: string | null
}

const DEV_DUMMY_CARD: GitHubRepoCard = {
  id: 'openai/openai-cookbook',
  categoryId: DEFAULT_MAIN_CATEGORY_ID,
  owner: 'openai',
  repo: 'openai-cookbook',
  fullName: 'openai/openai-cookbook',
  description: 'Examples and guides for building with OpenAI APIs.',
  summary:
    'OpenAI API를 활용한 예제와 가이드를 제공합니다. 프롬프트, 도구 호출, 멀티모달, 에이전트 패턴 등 실무에서 바로 참고할 수 있는 샘플 중심 저장소입니다.',
  htmlUrl: 'https://github.com/openai/openai-cookbook',
  homepage: null,
  language: 'Jupyter Notebook',
  stars: 99999,
  forks: 12000,
  watchers: 1300,
  openIssues: 110,
  topics: ['openai', 'examples', 'llm', 'cookbook'],
  license: 'MIT',
  defaultBranch: 'main',
  createdAt: '2022-11-10T00:00:00.000Z',
  updatedAt: new Date().toISOString(),
  addedAt: new Date().toISOString(),
  summaryStatus: 'ready',
  summaryProvider: 'none',
  summaryUpdatedAt: null,
  summaryError: null,
}

const getInitialCards = (useLocalCache: boolean): GitHubRepoCard[] => {
  if (!useLocalCache) {
    return []
  }

  const storedCards = loadCards()

  if (storedCards.length > 0) {
    return storedCards
  }

  if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
    return [DEV_DUMMY_CARD]
  }

  return []
}

type DashboardAction =
  | { type: 'addCard'; payload: GitHubRepoCard }
  | { type: 'removeCard'; payload: { repoId: string } }
  | { type: 'selectRepo'; payload: { repoId: string } }
  | { type: 'closeModal' }
  | { type: 'setPage'; payload: { page: number } }
  | { type: 'addNote'; payload: RepoNote }
  | { type: 'selectCategory'; payload: { categoryId: CategoryId } }
  | { type: 'createCategory'; payload: { category: Category } }
  | { type: 'renameCategory'; payload: { categoryId: CategoryId; name: string } }
  | { type: 'deleteCategory'; payload: { categoryId: CategoryId } }
  | { type: 'moveCardToCategory'; payload: { repoId: string; targetCategoryId: CategoryId } }
  | {
      type: 'patchCardSummary'
      payload: {
        repoId: string
        patch: Partial<
          Pick<
            GitHubRepoCard,
            'summary' | 'summaryStatus' | 'summaryProvider' | 'summaryUpdatedAt' | 'summaryError'
          >
        >
      }
    }
  | { type: 'hydrateCategories'; payload: { categories: Category[]; selectedCategoryId: CategoryId } }
  | {
      type: 'hydrateDashboard'
      payload: {
        cards: GitHubRepoCard[]
        notesByRepo: NotesByRepo
        categories: Category[]
        selectedCategoryId: CategoryId
      }
    }

type InitialStateOptions = {
  useLocalCache?: boolean
}

export const initialState = (options: InitialStateOptions = {}): DashboardState => {
  const useLocalCache = options.useLocalCache ?? true
  const categories = ensureCategories(useLocalCache ? loadCategories() : [])
  const selectedCategoryId = useLocalCache ? loadSelectedCategoryId() : DEFAULT_MAIN_CATEGORY_ID
  const resolvedSelectedCategoryId = categories.some((category) => category.id === selectedCategoryId)
    ? (selectedCategoryId as CategoryId)
    : DEFAULT_MAIN_CATEGORY_ID

  return {
    cards: migrateCards(getInitialCards(useLocalCache), categories),
    notesByRepo: useLocalCache ? loadNotes() : {},
    categories,
    selectedCategoryId: resolvedSelectedCategoryId,
    currentPage: 1,
    selectedRepoId: null,
  }
}

export const dashboardReducer = (state: DashboardState, action: DashboardAction): DashboardState => {
  switch (action.type) {
    case 'addCard': {
      const insertIndex = state.cards.findIndex((card) => card.categoryId === action.payload.categoryId)
      const cards =
        insertIndex < 0
          ? [...state.cards, action.payload]
          : [...state.cards.slice(0, insertIndex), action.payload, ...state.cards.slice(insertIndex)]

      return {
        ...state,
        cards,
      }
    }
    case 'removeCard': {
      const filteredCards = state.cards.filter((card) => card.id !== action.payload.repoId)
      const remainingNotes = { ...state.notesByRepo }
      delete remainingNotes[action.payload.repoId]

      return {
        ...state,
        cards: filteredCards,
        notesByRepo: remainingNotes,
        selectedRepoId: state.selectedRepoId === action.payload.repoId ? null : state.selectedRepoId,
      }
    }
    case 'selectRepo': {
      return {
        ...state,
        selectedRepoId: action.payload.repoId,
      }
    }
    case 'closeModal': {
      return {
        ...state,
        selectedRepoId: null,
      }
    }
    case 'setPage': {
      return {
        ...state,
        currentPage: Math.max(1, action.payload.page),
      }
    }
    case 'addNote': {
      const previousNotes = state.notesByRepo[action.payload.repoId] ?? []

      return {
        ...state,
        notesByRepo: {
          ...state.notesByRepo,
          [action.payload.repoId]: [action.payload, ...previousNotes],
        },
      }
    }
    case 'selectCategory': {
      if (!state.categories.some((category) => category.id === action.payload.categoryId)) {
        return state
      }

      return {
        ...state,
        selectedCategoryId: action.payload.categoryId,
        currentPage: 1,
      }
    }
    case 'createCategory': {
      return {
        ...state,
        categories: [...state.categories, action.payload.category],
        selectedCategoryId: action.payload.category.id,
        currentPage: 1,
      }
    }
    case 'renameCategory': {
      return {
        ...state,
        categories: state.categories.map((category) =>
          category.id === action.payload.categoryId ? { ...category, name: action.payload.name } : category,
        ),
      }
    }
    case 'deleteCategory': {
      const target = state.categories.find((category) => category.id === action.payload.categoryId)
      if (!target || target.isSystem) {
        return state
      }

      const remainingCategories = state.categories.filter((category) => category.id !== action.payload.categoryId)
      const movedCards = state.cards
        .filter((card) => card.categoryId === action.payload.categoryId)
        .map((card) => ({ ...card, categoryId: DEFAULT_WAREHOUSE_CATEGORY_ID }))
      const remainingCards = state.cards.filter((card) => card.categoryId !== action.payload.categoryId)

      const warehouseIndex = remainingCards.findIndex(
        (card) => card.categoryId === DEFAULT_WAREHOUSE_CATEGORY_ID,
      )

      const cards =
        warehouseIndex < 0
          ? [...remainingCards, ...movedCards]
          : [
              ...remainingCards.slice(0, warehouseIndex),
              ...movedCards,
              ...remainingCards.slice(warehouseIndex),
            ]

      return {
        ...state,
        categories: remainingCategories,
        cards,
        selectedCategoryId:
          state.selectedCategoryId === action.payload.categoryId
            ? DEFAULT_MAIN_CATEGORY_ID
            : state.selectedCategoryId,
        currentPage: 1,
      }
    }
    case 'moveCardToCategory': {
      const currentCard = state.cards.find((card) => card.id === action.payload.repoId)
      if (!currentCard || currentCard.categoryId === action.payload.targetCategoryId) {
        return state
      }

      const cardsWithoutTarget = state.cards.filter((card) => card.id !== action.payload.repoId)
      const movedCard: GitHubRepoCard = {
        ...currentCard,
        categoryId: action.payload.targetCategoryId,
      }

      const destinationIndex = cardsWithoutTarget.findIndex(
        (card) => card.categoryId === action.payload.targetCategoryId,
      )

      const cards =
        destinationIndex < 0
          ? [...cardsWithoutTarget, movedCard]
          : [
              ...cardsWithoutTarget.slice(0, destinationIndex),
              movedCard,
              ...cardsWithoutTarget.slice(destinationIndex),
            ]

      return {
        ...state,
        cards,
      }
    }
    case 'patchCardSummary': {
      if (!state.cards.some((card) => card.id === action.payload.repoId)) {
        return state
      }

      return {
        ...state,
        cards: state.cards.map((card) => {
          if (card.id !== action.payload.repoId) {
            return card
          }

          return {
            ...card,
            ...action.payload.patch,
          }
        }),
      }
    }
    case 'hydrateCategories': {
      const categories = ensureCategories(action.payload.categories)
      const selectedCategoryId = categories.some((category) => category.id === action.payload.selectedCategoryId)
        ? action.payload.selectedCategoryId
        : DEFAULT_MAIN_CATEGORY_ID

      return {
        ...state,
        categories,
        selectedCategoryId,
        cards: migrateCards(state.cards, categories),
      }
    }
    case 'hydrateDashboard': {
      const categories = ensureCategories(action.payload.categories)
      const selectedCategoryId = categories.some((category) => category.id === action.payload.selectedCategoryId)
        ? action.payload.selectedCategoryId
        : DEFAULT_MAIN_CATEGORY_ID

      return {
        ...state,
        cards: migrateCards(action.payload.cards, categories),
        notesByRepo: action.payload.notesByRepo,
        categories,
        selectedCategoryId,
        currentPage: 1,
      }
    }
    default: {
      return state
    }
  }
}
