export type ThemeMode = 'light' | 'dark'

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
