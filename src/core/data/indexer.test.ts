import { describe, expect, it } from 'vitest'
import type { UnifiedItem } from '@shared/types'
import { buildUnifiedIndex, tokenize } from './indexer'

const makeItem = (overrides: Partial<UnifiedItem>): UnifiedItem => ({
  id: 'github:facebook/react',
  provider: 'github',
  type: 'repository',
  nativeId: 'facebook/react',
  title: 'facebook/react',
  summary: 'React UI library',
  description: 'Build user interfaces',
  url: 'https://github.com/facebook/react',
  tags: ['ui', 'react'],
  author: 'facebook',
  language: 'TypeScript',
  metrics: {
    stars: 1,
    forks: 1,
  },
  status: 'active',
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: '2026-02-15T00:00:00.000Z',
  savedAt: '2026-02-15T00:00:00.000Z',
  raw: {},
  ...overrides,
})

describe('indexer', () => {
  it('tokenizes mixed string safely', () => {
    expect(tokenize('React, UI-library!')).toEqual(['react', 'ui-library'])
  })

  it('builds provider/type/sort/token indexes', () => {
    const newer = makeItem({
      id: 'github:vercel/next.js',
      nativeId: 'vercel/next.js',
      title: 'vercel/next.js',
      updatedAt: '2026-02-16T00:00:00.000Z',
      summary: 'Next.js framework',
      tags: ['nextjs'],
    })
    const older = makeItem({
      id: 'github:facebook/react',
      updatedAt: '2026-02-14T00:00:00.000Z',
    })

    const index = buildUnifiedIndex([older, newer])

    expect(index.byProvider.github).toEqual(['github:vercel/next.js', 'github:facebook/react'])
    expect(index.byType.repository).toEqual(['github:vercel/next.js', 'github:facebook/react'])
    expect(index.byUpdatedAtDesc[0]).toBe('github:vercel/next.js')
    expect(index.tokenToIds.react).toContain('github:facebook/react')
    expect(index.tokenToIds['nextjs']).toContain('github:vercel/next.js')
  })
})
