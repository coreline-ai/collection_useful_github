import { describe, expect, it } from 'vitest'
import { toYoutubeUnifiedItem } from './toUnifiedItem'

describe('toYoutubeUnifiedItem', () => {
  it('maps youtube card to unified schema', () => {
    const item = toYoutubeUnifiedItem(
      {
        id: 'dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
        categoryId: 'main',
        title: 'Never Gonna Give You Up',
        channelTitle: 'Rick Astley',
        description: 'Official music video',
        thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        publishedAt: '2026-01-01T00:00:00.000Z',
        viewCount: 123,
        likeCount: 7,
        summaryText: '핵심 요약',
        summaryStatus: 'ready',
        summaryUpdatedAt: '2026-01-03T00:00:00.000Z',
        summaryProvider: 'glm',
        summaryError: null,
        notebookSourceStatus: 'disabled',
        notebookSourceId: null,
        notebookId: null,
        addedAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
      3,
    )

    expect(item.id).toBe('youtube:dQw4w9WgXcQ')
    expect(item.provider).toBe('youtube')
    expect(item.type).toBe('video')
    expect(item.nativeId).toBe('dQw4w9WgXcQ')
    expect(item.title).toBe('Never Gonna Give You Up')
    expect(item.summary).toBe('핵심 요약')
    expect(item.author).toBe('Rick Astley')
    expect(item.metrics).toEqual({ views: 123, likes: 7 })
    expect(item.raw).toMatchObject({ categoryId: 'main', sortIndex: 3 })
  })

  it('marks warehouse category as archived and keeps null like count', () => {
    const item = toYoutubeUnifiedItem(
      {
        id: 'abc12345678',
        videoId: 'abc12345678',
        categoryId: 'warehouse',
        title: '영상',
        channelTitle: '채널',
        description: '',
        thumbnailUrl: 'https://img',
        videoUrl: 'https://www.youtube.com/watch?v=abc12345678',
        publishedAt: '2026-01-01T00:00:00.000Z',
        viewCount: 0,
        likeCount: null,
        summaryText: '',
        summaryStatus: 'idle',
        summaryUpdatedAt: null,
        summaryProvider: 'none',
        summaryError: null,
        notebookSourceStatus: 'disabled',
        notebookSourceId: null,
        notebookId: null,
        addedAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      0,
    )

    expect(item.status).toBe('archived')
    expect(item.metrics).toEqual({ views: 0, likes: undefined })
    expect(item.summary).toBe('영상 설명이 없습니다.')
  })
})
