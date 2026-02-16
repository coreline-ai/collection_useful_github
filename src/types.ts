export type ThemeMode = 'light' | 'dark'
export type TopSection = 'search' | 'github' | 'youtube' | 'bookmark'
export type ProviderType = 'github' | 'youtube' | 'bookmark'
export type UnifiedItemType = 'repository' | 'video' | 'bookmark'
export type UnifiedStatus = 'active' | 'archived'
export type SyncConnectionStatus = 'healthy' | 'retrying' | 'local' | 'recovered'

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
  revision?: number
}

export type YouTubeVideoCard = {
  id: string
  categoryId: CategoryId
  videoId: string
  title: string
  channelTitle: string
  description: string
  thumbnailUrl: string
  videoUrl: string
  publishedAt: string
  viewCount: number
  likeCount: number | null
  addedAt: string
  updatedAt: string
}

export type YouTubeDashboardSnapshot = {
  cards: YouTubeVideoCard[]
  categories: Category[]
  selectedCategoryId: CategoryId
  revision?: number
}

export type BookmarkLinkStatus =
  | 'unknown'
  | 'ok'
  | 'redirected'
  | 'blocked'
  | 'not_found'
  | 'timeout'
  | 'error'

export type BookmarkCard = {
  id: string
  categoryId: CategoryId
  url: string
  normalizedUrl: string
  canonicalUrl: string | null
  domain: string
  title: string
  excerpt: string
  thumbnailUrl: string | null
  faviconUrl: string | null
  tags: string[]
  addedAt: string
  updatedAt: string
  metadataStatus: 'ok' | 'fallback'
  linkStatus: BookmarkLinkStatus
  lastCheckedAt: string | null
  lastStatusCode: number | null
  lastResolvedUrl: string | null
}

export type BookmarkDashboardSnapshot = {
  cards: BookmarkCard[]
  categories: Category[]
  selectedCategoryId: CategoryId
  revision?: number
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
  score?: number
  matchedBy?: Array<'exact' | 'prefix' | 'fts' | 'trgm'>
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
