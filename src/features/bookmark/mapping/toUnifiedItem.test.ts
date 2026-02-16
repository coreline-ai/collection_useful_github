import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toBookmarkUnifiedItem } from './toUnifiedItem'

describe('toBookmarkUnifiedItem', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-16T08:30:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps bookmark draft to unified item with defaults', () => {
    const item = toBookmarkUnifiedItem({
      nativeId: 'post-1',
      title: 'Post title',
      summary: 'Post summary',
      description: 'Post description',
      url: 'https://example.com/post-1',
    })

    expect(item.id).toBe('bookmark:post-1')
    expect(item.provider).toBe('bookmark')
    expect(item.type).toBe('bookmark')
    expect(item.tags).toEqual([])
    expect(item.author).toBeNull()
    expect(item.metrics).toEqual({})
    expect(item.createdAt).toBe('2026-02-16T08:30:00.000Z')
    expect(item.updatedAt).toBe('2026-02-16T08:30:00.000Z')
    expect(item.savedAt).toBe('2026-02-16T08:30:00.000Z')
  })

  it('keeps explicit timestamps when provided', () => {
    const item = toBookmarkUnifiedItem({
      nativeId: 'post-2',
      title: 'Post title',
      summary: 'Post summary',
      description: 'Post description',
      url: 'https://example.com/post-2',
      tags: ['news'],
      author: 'author',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })

    expect(item.tags).toEqual(['news'])
    expect(item.author).toBe('author')
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(item.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(item.savedAt).toBe('2026-02-16T08:30:00.000Z')
  })
})
