import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toYoutubeUnifiedItem } from './toUnifiedItem'

describe('toYoutubeUnifiedItem', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fills optional values with defaults and current timestamp', () => {
    const item = toYoutubeUnifiedItem({
      nativeId: 'video-1',
      title: 'Video title',
      summary: 'Video summary',
      description: 'Video description',
      url: 'https://youtube.com/watch?v=video-1',
    })

    expect(item.id).toBe('youtube:video-1')
    expect(item.provider).toBe('youtube')
    expect(item.type).toBe('video')
    expect(item.tags).toEqual([])
    expect(item.author).toBeNull()
    expect(item.createdAt).toBe('2026-02-16T12:00:00.000Z')
    expect(item.updatedAt).toBe('2026-02-16T12:00:00.000Z')
    expect(item.savedAt).toBe('2026-02-16T12:00:00.000Z')
  })

  it('keeps explicit draft values when provided', () => {
    const item = toYoutubeUnifiedItem({
      nativeId: 'video-2',
      title: 'Video title',
      summary: 'Video summary',
      description: 'Video description',
      url: 'https://youtube.com/watch?v=video-2',
      tags: ['tag'],
      author: 'creator',
      views: 10,
      likes: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })

    expect(item.tags).toEqual(['tag'])
    expect(item.author).toBe('creator')
    expect(item.metrics).toEqual({ views: 10, likes: 3 })
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(item.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(item.savedAt).toBe('2026-02-16T12:00:00.000Z')
  })
})
