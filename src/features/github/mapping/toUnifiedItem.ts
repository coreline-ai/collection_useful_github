import { DEFAULT_WAREHOUSE_CATEGORY_ID } from '@constants'
import type { GitHubRepoCard, UnifiedItem } from '@shared/types'

export const toGithubUnifiedItem = (card: GitHubRepoCard): UnifiedItem => ({
  id: `github:${card.id}`,
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
    categoryId: card.categoryId,
    defaultBranch: card.defaultBranch,
    homepage: card.homepage,
    openIssues: card.openIssues,
    license: card.license,
    card,
  },
})
