import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MAIN_CATEGORY_ID } from '@constants'
import type { GitHubRepoCard, RepoNote } from '@shared/types'
import { saveCards, saveCategories, saveNotes } from '@shared/storage/localStorage'
import { loadUnifiedItemsMap, loadUnifiedMeta, loadUnifiedNotes } from './adapters/localDb'
import { runInitialMigrations } from './migration'

const legacyCard: GitHubRepoCard = {
  id: 'facebook/react',
  categoryId: DEFAULT_MAIN_CATEGORY_ID,
  owner: 'facebook',
  repo: 'react',
  fullName: 'facebook/react',
  description: 'React repo',
  summary: 'React summary',
  htmlUrl: 'https://github.com/facebook/react',
  homepage: 'https://react.dev',
  language: 'TypeScript',
  stars: 10,
  forks: 2,
  watchers: 1,
  openIssues: 5,
  topics: ['react'],
  license: 'MIT',
  defaultBranch: 'main',
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: '2026-02-15T00:00:00.000Z',
  addedAt: '2026-02-15T00:00:00.000Z',
}

const note: RepoNote = {
  id: 'n1',
  repoId: 'facebook/react',
  content: 'memo',
  createdAt: '2026-02-16T00:00:00.000Z',
}

describe('runInitialMigrations', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('migrates github cards and notes once', () => {
    saveCards([legacyCard])
    saveCategories([
      { id: 'main', name: '메인', isSystem: true, createdAt: '2026-02-01T00:00:00.000Z' },
      { id: 'warehouse', name: '창고', isSystem: true, createdAt: '2026-02-01T00:00:00.000Z' },
    ])
    saveNotes({ 'facebook/react': [note] })

    runInitialMigrations()

    const items = loadUnifiedItemsMap()
    const unified = items['github:facebook/react']
    expect(unified).toBeDefined()
    expect(unified.provider).toBe('github')

    const notes = loadUnifiedNotes()
    expect(notes['github:facebook/react'][0].repoId).toBe('github:facebook/react')

    const meta = loadUnifiedMeta()
    expect(meta.migrated.githubV1ToUnifiedV1).toBe(true)

    // second run should keep migrated flag true without throwing
    runInitialMigrations()
    expect(loadUnifiedMeta().migrated.githubV1ToUnifiedV1).toBe(true)
  })
})
