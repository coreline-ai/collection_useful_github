import type { ProviderType, UnifiedItem } from '@shared/types'
import { buildUnifiedIndex, normalizeSearchToken } from './indexer'
import {
  loadUnifiedIndexes,
  loadUnifiedItemsMap,
  saveUnifiedIndexes,
  saveUnifiedItemsMap,
} from './adapters/localDb'
import type { UnifiedItemsMap } from './schema'

export interface UnifiedRepository {
  getItem(id: string): UnifiedItem | null
  upsertItem(item: UnifiedItem): void
  removeItem(id: string): void
  listByProvider(provider: ProviderType): UnifiedItem[]
  searchByToken(token: string): string[]
  rebuildIndexes(): void
}

const toSortedItems = (itemsMap: UnifiedItemsMap): UnifiedItem[] => Object.values(itemsMap)

export class LocalUnifiedRepository implements UnifiedRepository {
  getItem(id: string): UnifiedItem | null {
    const items = loadUnifiedItemsMap()
    return items[id] ?? null
  }

  upsertItem(item: UnifiedItem): void {
    const items = loadUnifiedItemsMap()
    items[item.id] = item
    this.persistWithRebuiltIndexes(items)
  }

  upsertItems(nextItems: UnifiedItem[]): void {
    if (nextItems.length === 0) {
      return
    }

    const items = loadUnifiedItemsMap()

    for (const item of nextItems) {
      items[item.id] = item
    }

    this.persistWithRebuiltIndexes(items)
  }

  removeItem(id: string): void {
    const items = loadUnifiedItemsMap()

    if (!items[id]) {
      return
    }

    delete items[id]
    this.persistWithRebuiltIndexes(items)
  }

  replaceProviderItems(provider: ProviderType, itemsByProvider: UnifiedItem[]): void {
    const items = loadUnifiedItemsMap()

    for (const [id, item] of Object.entries(items)) {
      if (item.provider === provider) {
        delete items[id]
      }
    }

    for (const item of itemsByProvider) {
      items[item.id] = item
    }

    this.persistWithRebuiltIndexes(items)
  }

  listByProvider(provider: ProviderType): UnifiedItem[] {
    const itemsMap = loadUnifiedItemsMap()
    const index = loadUnifiedIndexes()
    const ids = index.byProvider[provider] ?? []

    return ids.map((id) => itemsMap[id]).filter((item): item is UnifiedItem => Boolean(item))
  }

  searchByToken(token: string): string[] {
    const index = loadUnifiedIndexes()
    const normalized = normalizeSearchToken(token)

    if (!normalized) {
      return []
    }

    return index.tokenToIds[normalized] ?? []
  }

  rebuildIndexes(): void {
    const items = loadUnifiedItemsMap()
    const nextIndex = buildUnifiedIndex(toSortedItems(items))
    saveUnifiedIndexes(nextIndex)
  }

  private persistWithRebuiltIndexes(items: UnifiedItemsMap) {
    saveUnifiedItemsMap(items)
    const nextIndex = buildUnifiedIndex(toSortedItems(items))
    saveUnifiedIndexes(nextIndex)
  }
}

let singletonRepository: LocalUnifiedRepository | null = null

export const getUnifiedRepository = (): LocalUnifiedRepository => {
  if (!singletonRepository) {
    singletonRepository = new LocalUnifiedRepository()
  }

  return singletonRepository
}
