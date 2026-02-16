import type { ProviderType, UnifiedIndex, UnifiedItemType, UnifiedMeta, UnifiedStatus } from '@shared/types'

export type UnifiedItemsMap = Record<string, import('@shared/types').UnifiedItem>
export type UnifiedNotesByItem = Record<string, import('@shared/types').RepoNote[]>

export const PROVIDER_TYPES: ProviderType[] = ['github', 'youtube', 'bookmark']
export const UNIFIED_ITEM_TYPES: UnifiedItemType[] = ['repository', 'video', 'bookmark']
export const UNIFIED_STATUSES: UnifiedStatus[] = ['active', 'archived']

export const createEmptyUnifiedIndex = (): UnifiedIndex => ({
  byProvider: {
    github: [],
    youtube: [],
    bookmark: [],
  },
  byType: {
    repository: [],
    video: [],
    bookmark: [],
  },
  byStatus: {
    active: [],
    archived: [],
  },
  byUpdatedAtDesc: [],
  tokenToIds: {},
})

export const createInitialUnifiedMeta = (): UnifiedMeta => ({
  schemaVersion: 1,
  migrated: {
    githubV1ToUnifiedV1: false,
  },
})
