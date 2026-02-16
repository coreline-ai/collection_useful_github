import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildYouTubeSummary, fetchYouTubeVideo, parseYouTubeVideoUrl } from './youtube'

vi.mock('@core/data/adapters/remoteDb', () => ({
  getRemoteBaseUrl: vi.fn(() => 'http://localhost:4000'),
}))

const { getRemoteBaseUrl } = await import('@core/data/adapters/remoteDb')

const asResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })

describe('youtube service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(getRemoteBaseUrl).mockReturnValue('http://localhost:4000')
  })

  it('parses watch/youtu.be/shorts video urls', () => {
    expect(parseYouTubeVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      videoId: 'dQw4w9WgXcQ',
    })
    expect(parseYouTubeVideoUrl('youtu.be/dQw4w9WgXcQ?t=42')).toEqual({ videoId: 'dQw4w9WgXcQ' })
    expect(parseYouTubeVideoUrl('https://youtube.com/shorts/dQw4w9WgXcQ')).toEqual({
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('rejects channel and playlist urls', () => {
    expect(parseYouTubeVideoUrl('https://www.youtube.com/channel/UC123')).toBeNull()
    expect(parseYouTubeVideoUrl('https://www.youtube.com/playlist?list=PL123')).toBeNull()
  })

  it('builds summary in max 180 chars', () => {
    const summary = buildYouTubeSummary('a'.repeat(200))
    expect(summary.length).toBe(180)
    expect(summary.endsWith('...')).toBe(true)
  })

  it('fetches and maps youtube video metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        video: {
          videoId: 'dQw4w9WgXcQ',
          title: 'Never Gonna Give You Up',
          channelTitle: 'Rick Astley',
          description: 'Official video',
          thumbnailUrl: 'https://img',
          publishedAt: '2026-01-01T00:00:00.000Z',
          viewCount: 100,
          likeCount: 3,
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        },
      }),
    )

    const card = await fetchYouTubeVideo('dQw4w9WgXcQ')

    expect(card.id).toBe('dQw4w9WgXcQ')
    expect(card.videoId).toBe('dQw4w9WgXcQ')
    expect(card.channelTitle).toBe('Rick Astley')
    expect(card.viewCount).toBe(100)
  })

  it('throws when remote base is missing', async () => {
    vi.mocked(getRemoteBaseUrl).mockReturnValue(null)

    await expect(fetchYouTubeVideo('dQw4w9WgXcQ')).rejects.toThrow(
      '원격 DB API가 설정되지 않았습니다. VITE_POSTGRES_SYNC_API_BASE_URL을 확인해 주세요.',
    )
  })
})
