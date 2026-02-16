export type ThemeMode = 'light' | 'dark'
export type TopSection = 'github' | 'youtube' | 'bookmark'
export type ProviderType = TopSection
export type UnifiedItemType = 'repository' | 'video' | 'bookmark'
export type UnifiedStatus = 'active' | 'archived'

export type CategoryId = 'main' | 'warehouse' | string

export type Category = {
  id: CategoryId
  name: string
  isSystem: boolean
  createdAt: string
}

export type GitHubRepoCard = {
  id: string
  categoryId: CategoryId
  owner: string
  repo: string
  fullName: string
  description: string
  summary: string
  htmlUrl: string
  homepage: string | null
  language: string | null
  stars: number
  forks: number
  watchers: number
  openIssues: number
  topics: string[]
  license: string | null
  defaultBranch: string
  createdAt: string
  updatedAt: string
  addedAt: string
}

export type RepoNote = {
  id: string
  repoId: string
  content: string
  createdAt: string
}

export type NotesByRepo = Record<string, RepoNote[]>

export type RepoActivityItem = {
  id: string
  type: 'commit' | 'issue' | 'pull_request'
  title: string
  url: string
  author: string
  createdAt: string
}

export type RepoDetailData = {
  readmePreview: string | null
  recentActivity: RepoActivityItem[]
  latestCommitSha?: string | null
}

export type RepoDetailCacheEntry = {
  repoId: string
  cachedAt: string
  detail: RepoDetailData
}

export type RepoDetailCacheMap = Record<string, RepoDetailCacheEntry>

export type GitHubDashboardSnapshot = {
  cards: GitHubRepoCard[]
  notesByRepo: NotesByRepo
  categories: Category[]
  selectedCategoryId: CategoryId
}

export type UnifiedItem = {
  id: string
  provider: ProviderType
  type: UnifiedItemType
  nativeId: string
  title: string
  summary: string
  description: string
  url: string
  tags: string[]
  author: string | null
  language: string | null
  metrics: {
    stars?: number
    forks?: number
    watchers?: number
    views?: number
    likes?: number
  }
  status: UnifiedStatus
  createdAt: string
  updatedAt: string
  savedAt: string
  raw: Record<string, unknown>
}

export type UnifiedIndex = {
  byProvider: Record<ProviderType, string[]>
  byType: Record<UnifiedItemType, string[]>
  byStatus: Record<UnifiedStatus, string[]>
  byUpdatedAtDesc: string[]
  tokenToIds: Record<string, string[]>
}

export type UnifiedMeta = {
  schemaVersion: 1
  migrated: {
    githubV1ToUnifiedV1: boolean
    migratedAt?: string
  }
}
