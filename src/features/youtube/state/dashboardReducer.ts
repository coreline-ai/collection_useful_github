import { DEFAULT_MAIN_CATEGORY_ID, DEFAULT_WAREHOUSE_CATEGORY_ID } from '@constants'
import {
  loadYoutubeCards,
  loadYoutubeCategories,
  loadYoutubeSelectedCategoryId,
} from '@shared/storage/localStorage'
import type { Category, CategoryId, YouTubeVideoCard, YouTubeDashboardSnapshot } from '@shared/types'

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

  const customCategories = Array.from(categoriesById.values()).filter(
    (category) => category.id !== DEFAULT_MAIN_CATEGORY_ID && category.id !== DEFAULT_WAREHOUSE_CATEGORY_ID,
  )

  return [
    categoriesById.get(DEFAULT_MAIN_CATEGORY_ID)!,
    categoriesById.get(DEFAULT_WAREHOUSE_CATEGORY_ID)!,
    ...customCategories,
  ]
}

const migrateCards = (cards: YouTubeVideoCard[], categories: Category[]): YouTubeVideoCard[] => {
  const validCategoryIds = new Set(categories.map((category) => category.id))

  return cards.map((card) => ({
    ...card,
    summaryText: typeof card.summaryText === 'string' ? card.summaryText : '',
    summaryStatus:
      card.summaryStatus === 'queued' ||
      card.summaryStatus === 'ready' ||
      card.summaryStatus === 'failed'
        ? card.summaryStatus
        : typeof card.summaryText === 'string' && card.summaryText.trim()
          ? 'ready'
          : 'idle',
    videoId: card.videoId || card.id,
    categoryId: validCategoryIds.has(card.categoryId) ? card.categoryId : DEFAULT_MAIN_CATEGORY_ID,
    summaryUpdatedAt: card.summaryUpdatedAt || null,
    summaryProvider: card.summaryProvider === 'glm' ? 'glm' : 'none',
    summaryError: card.summaryError || null,
    notebookSourceStatus:
      card.notebookSourceStatus === 'queued' ||
      card.notebookSourceStatus === 'linked' ||
      card.notebookSourceStatus === 'failed'
        ? card.notebookSourceStatus
        : 'disabled',
    notebookSourceId: card.notebookSourceId || null,
    notebookId: card.notebookId || null,
  }))
}

export type YouTubeDashboardState = {
  cards: YouTubeVideoCard[]
  categories: Category[]
  selectedCategoryId: CategoryId
  currentPage: number
}

type YouTubeDashboardAction =
  | { type: 'addCard'; payload: YouTubeVideoCard }
  | { type: 'removeCard'; payload: { videoId: string } }
  | { type: 'setPage'; payload: { page: number } }
  | { type: 'selectCategory'; payload: { categoryId: CategoryId } }
  | { type: 'createCategory'; payload: { category: Category } }
  | { type: 'renameCategory'; payload: { categoryId: CategoryId; name: string } }
  | { type: 'deleteCategory'; payload: { categoryId: CategoryId } }
  | { type: 'moveCardToCategory'; payload: { videoId: string; targetCategoryId: CategoryId } }
  | { type: 'patchCard'; payload: { videoId: string; patch: Partial<YouTubeVideoCard> } }
  | {
      type: 'hydrateDashboard'
      payload: YouTubeDashboardSnapshot
    }

export const initialState = (): YouTubeDashboardState => {
  const categories = ensureCategories(loadYoutubeCategories())
  const selectedCategoryId = loadYoutubeSelectedCategoryId()
  const resolvedSelectedCategoryId = categories.some((category) => category.id === selectedCategoryId)
    ? (selectedCategoryId as CategoryId)
    : DEFAULT_MAIN_CATEGORY_ID

  return {
    cards: migrateCards(loadYoutubeCards(), categories),
    categories,
    selectedCategoryId: resolvedSelectedCategoryId,
    currentPage: 1,
  }
}

export const dashboardReducer = (
  state: YouTubeDashboardState,
  action: YouTubeDashboardAction,
): YouTubeDashboardState => {
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
      return {
        ...state,
        cards: state.cards.filter((card) => card.id !== action.payload.videoId),
      }
    }
    case 'setPage': {
      return {
        ...state,
        currentPage: Math.max(1, action.payload.page),
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
          : [...remainingCards.slice(0, warehouseIndex), ...movedCards, ...remainingCards.slice(warehouseIndex)]

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
      const currentCard = state.cards.find((card) => card.id === action.payload.videoId)
      if (!currentCard || currentCard.categoryId === action.payload.targetCategoryId) {
        return state
      }

      const cardsWithoutTarget = state.cards.filter((card) => card.id !== action.payload.videoId)
      const movedCard: YouTubeVideoCard = {
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
    case 'patchCard': {
      const hasTarget = state.cards.some((card) => card.id === action.payload.videoId)
      if (!hasTarget) {
        return state
      }

      return {
        ...state,
        cards: state.cards.map((card) =>
          card.id === action.payload.videoId ? { ...card, ...action.payload.patch } : card,
        ),
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
