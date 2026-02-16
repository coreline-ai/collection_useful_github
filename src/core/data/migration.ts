import { DEFAULT_WAREHOUSE_CATEGORY_ID } from '@constants'
import type { GitHubRepoCard, UnifiedItem } from '@shared/types'
import { loadCards, loadCategories, loadNotes } from '@shared/storage/localStorage'
import {
  loadUnifiedMeta,
  loadUnifiedNotes,
  saveUnifiedMeta,
  saveUnifiedNotes,
} from './adapters/localDb'
import { getUnifiedRepository } from './repository'
import type { UnifiedNotesByItem } from './schema'

const toUnifiedId = (repoId: string): string => `github:${repoId.toLowerCase()}`

const mapGithubCardToUnified = (card: GitHubRepoCard): UnifiedItem => ({
  id: toUnifiedId(card.id),
  provider: 'github',
  type: 'repository',
  nativeId: card.id,
  title: card.fullName,
  summary: card.summary,
  description: card.description,
  url: card.htmlUrl,
  tags: card.topics,
  author: card.owner,
  language: card.language,
  metrics: {
    stars: card.stars,
    forks: card.forks,
    watchers: card.watchers,
  },
  status: card.categoryId === DEFAULT_WAREHOUSE_CATEGORY_ID ? 'archived' : 'active',
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
  savedAt: card.addedAt,
  raw: {
    source: 'github_cards_v1',
    categoryId: card.categoryId,
    card,
  },
})

const migrateLegacyGithubNotes = (): UnifiedNotesByItem => {
  const legacyNotes = loadNotes()
  const existingUnifiedNotes = loadUnifiedNotes()

  const migratedEntries = Object.entries(legacyNotes).reduce<UnifiedNotesByItem>((accumulator, [repoId, notes]) => {
    const unifiedId = toUnifiedId(repoId)
    accumulator[unifiedId] = notes.map((note) => ({
      ...note,
      repoId: unifiedId,
    }))
    return accumulator
  }, {})

  return {
    ...existingUnifiedNotes,
    ...migratedEntries,
  }
}

export const runInitialMigrations = (): void => {
  const meta = loadUnifiedMeta()

  if (meta.migrated.githubV1ToUnifiedV1) {
    return
  }

  try {
    const repository = getUnifiedRepository()
    const legacyCards = loadCards()
    const legacyCategories = loadCategories()

    if (legacyCards.length > 0) {
      const unifiedItems = legacyCards.map((card) => mapGithubCardToUnified(card))
      repository.replaceProviderItems('github', unifiedItems)
    } else {
      repository.rebuildIndexes()
    }

    const nextNotes = migrateLegacyGithubNotes()
    saveUnifiedNotes(nextNotes)

    saveUnifiedMeta({
      schemaVersion: 1,
      migrated: {
        githubV1ToUnifiedV1: true,
        migratedAt: new Date().toISOString(),
      },
    })

    if (legacyCategories.length === 0) {
      // no-op: reserved for future provider/category migration phases
    }
  } catch (error) {
    console.error('[migration] githubV1ToUnifiedV1 failed', error)
  }
}
