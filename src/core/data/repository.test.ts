import { beforeEach, describe, expect, it } from 'vitest'
import type { UnifiedItem } from '@shared/types'
import { LocalUnifiedRepository } from './repository'

const makeItem = (overrides: Partial<UnifiedItem>): UnifiedItem => ({
  id: 'github:facebook/react',
  provider: 'github',
  type: 'repository',
  nativeId: 'facebook/react',
  title: 'facebook/react',
  summary: 'React UI library',
  description: 'Build user interfaces',
  url: 'https://github.com/facebook/react',
  tags: ['react'],
  author: 'facebook',
  language: 'TypeScript',
  metrics: { stars: 1, forks: 1 },
  status: 'active',
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: '2026-02-15T00:00:00.000Z',
  savedAt: '2026-02-15T00:00:00.000Z',
  raw: {},
  ...overrides,
})

describe('LocalUnifiedRepository', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('upserts and reads item', () => {
    const repository = new LocalUnifiedRepository()
    const item = makeItem({})

    repository.upsertItem(item)

    expect(repository.getItem(item.id)?.title).toBe('facebook/react')
  })

  it('replaces provider items and removes stale ids', () => {
    const repository = new LocalUnifiedRepository()

    repository.upsertItem(makeItem({ id: 'github:facebook/react' }))
    repository.replaceProviderItems('github', [makeItem({ id: 'github:vercel/next.js', nativeId: 'vercel/next.js' })])

    expect(repository.getItem('github:facebook/react')).toBeNull()
    expect(repository.listByProvider('github')).toHaveLength(1)
    expect(repository.listByProvider('github')[0].id).toBe('github:vercel/next.js')
  })

  it('searches by token', () => {
    const repository = new LocalUnifiedRepository()

    repository.upsertItem(makeItem({ id: 'github:facebook/react', summary: 'React renderer' }))

    expect(repository.searchByToken('react')).toContain('github:facebook/react')
  })

  it('removes item', () => {
    const repository = new LocalUnifiedRepository()
    const item = makeItem({})

    repository.upsertItem(item)
    repository.removeItem(item.id)

    expect(repository.getItem(item.id)).toBeNull()
  })
})
