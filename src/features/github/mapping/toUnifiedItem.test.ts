import { describe, expect, it } from 'vitest'
import { DEFAULT_WAREHOUSE_CATEGORY_ID } from '@constants'
import type { GitHubRepoCard } from '@shared/types'
import { toGithubUnifiedItem } from './toUnifiedItem'

const baseCard: GitHubRepoCard = {
  id: 'facebook/react',
  categoryId: 'main',
  owner: 'facebook',
  repo: 'react',
  fullName: 'facebook/react',
  description: 'React description',
  summary: 'React summary',
  htmlUrl: 'https://github.com/facebook/react',
  homepage: 'https://react.dev',
  language: 'TypeScript',
  stars: 1,
  forks: 2,
  watchers: 3,
  openIssues: 4,
  topics: ['ui', 'frontend'],
  license: 'MIT',
  defaultBranch: 'main',
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-02T00:00:00.000Z',
  addedAt: '2026-02-03T00:00:00.000Z',
}

describe('toGithubUnifiedItem', () => {
  it('maps github card to unified item fields', () => {
    const item = toGithubUnifiedItem(baseCard)

    expect(item.id).toBe('github:facebook/react')
    expect(item.provider).toBe('github')
    expect(item.type).toBe('repository')
    expect(item.nativeId).toBe('facebook/react')
    expect(item.metrics).toEqual({ stars: 1, forks: 2, watchers: 3 })
    expect(item.status).toBe('active')
    expect(item.raw.categoryId).toBe('main')
  })

  it('marks card in warehouse category as archived', () => {
    const item = toGithubUnifiedItem({
      ...baseCard,
      categoryId: DEFAULT_WAREHOUSE_CATEGORY_ID,
    })

    expect(item.status).toBe('archived')
  })
})
