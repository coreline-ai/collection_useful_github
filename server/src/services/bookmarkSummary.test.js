import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateBookmarkSummaryState } from './bookmarkSummary.js'

describe('bookmarkSummary service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps disabled-safe behavior without external summary call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const result = await generateBookmarkSummaryState({
      metadata: {
        bookmarkId: 'https://example.com/post',
        title: 'Example',
        excerpt: '기존 발췌',
        domain: 'example.com',
        normalizedUrl: 'https://example.com/post',
      },
      currentCard: {
        summaryText: '기존 요약',
        summaryStatus: 'ready',
        summaryProvider: 'none',
        summaryUpdatedAt: '2026-01-01T00:00:00.000Z',
      },
      config: {
        summaryEnabled: false,
        summaryProvider: 'glm',
        timeoutMs: 1000,
        glm: {
          apiKey: '',
          baseUrl: '',
          model: '',
        },
      },
    })

    expect(result.summaryStatus).toBe('ready')
    expect(result.summaryText).toBe('기존 요약')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns ready summary from glm provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '북마크 한국어 요약 1. 북마크 한국어 요약 2. 북마크 한국어 요약 3.',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    const result = await generateBookmarkSummaryState({
      metadata: {
        bookmarkId: 'https://example.com/post',
        title: 'Example',
        excerpt: '발췌',
        domain: 'example.com',
        normalizedUrl: 'https://example.com/post',
      },
      currentCard: null,
      force: true,
      config: {
        summaryEnabled: true,
        summaryProvider: 'glm',
        timeoutMs: 1000,
        glm: {
          apiKey: 'test-key',
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
          model: 'glm-4.7',
        },
      },
    })

    expect(result.summaryStatus).toBe('ready')
    expect(result.summaryProvider).toBe('glm')
    expect(result.summaryText.length).toBeGreaterThan(0)
  })
})
