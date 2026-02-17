import { describe, expect, it, vi } from 'vitest'

vi.mock('./glmSummary.js', () => ({
  summarizeYoutubeWithGlm: vi.fn(async () => 'GLM 요약'),
}))

import { summarizeYoutubeWithGlm } from './glmSummary.js'
import { generateYoutubeSummaryState } from './youtubeSummary.js'

describe('youtubeSummary service', () => {
  it('keeps disabled-safe behavior without external summary call', async () => {
    const result = await generateYoutubeSummaryState({
      videoId: 'dQw4w9WgXcQ',
      metadata: {
        title: 'Video',
        channelTitle: 'Channel',
        description: 'Desc',
        publishedAt: '2026-01-01T00:00:00.000Z',
        viewCount: 10,
      },
      currentCard: null,
      config: {
        summaryEnabled: false,
        summaryProvider: 'glm',
        timeoutMs: 1000,
        notebook: {
          enabled: false,
          projectId: '',
          location: 'global',
          notebookId: '',
          serviceAccountJson: '',
        },
        glm: {
          apiKey: '',
          baseUrl: '',
          model: '',
        },
      },
    })

    expect(result.summaryStatus).toBe('idle')
    expect(result.summaryProvider).toBe('none')
    expect(result.notebookSourceStatus).toBe('disabled')
    expect(summarizeYoutubeWithGlm).not.toHaveBeenCalled()
  })

  it('returns ready summary from glm provider', async () => {
    const result = await generateYoutubeSummaryState({
      videoId: 'dQw4w9WgXcQ',
      metadata: {
        title: 'Video',
        channelTitle: 'Channel',
        description: 'Desc',
        publishedAt: '2026-01-01T00:00:00.000Z',
        viewCount: 10,
      },
      currentCard: null,
      force: true,
      config: {
        summaryEnabled: true,
        summaryProvider: 'glm',
        timeoutMs: 1000,
        notebook: {
          enabled: false,
          projectId: '',
          location: 'global',
          notebookId: '',
          serviceAccountJson: '',
        },
        glm: {
          apiKey: 'test-key',
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
          model: 'glm-4.7',
        },
      },
    })

    expect(result.summaryStatus).toBe('ready')
    expect(result.summaryProvider).toBe('glm')
    expect(result.summaryText).toBe('GLM 요약')
  })
})
