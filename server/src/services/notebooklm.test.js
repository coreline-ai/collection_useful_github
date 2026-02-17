import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureYoutubeNotebookSource, resolveNotebookLmConfig } from './notebooklm.js'

vi.mock('google-auth-library', () => {
  const getRequestHeaders = vi.fn(async () => ({ Authorization: 'Bearer test-token' }))
  const getClient = vi.fn(async () => ({ getRequestHeaders }))
  class GoogleAuth {
    async getClient() {
      return getClient()
    }
  }

  return {
    GoogleAuth,
    __mocks: {
      getRequestHeaders,
      getClient,
      GoogleAuth,
    },
  }
})

const { __mocks } = await import('google-auth-library')

const asResponse = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('notebooklm service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('resolves config with endpointLocation fallback', () => {
    const config = resolveNotebookLmConfig({
      NOTEBOOKLM_ENABLED: 'true',
      NOTEBOOKLM_PROJECT_ID: 'project-123',
      NOTEBOOKLM_LOCATION: 'global',
      NOTEBOOKLM_NOTEBOOK_ID: 'nb-1',
      NOTEBOOKLM_SERVICE_ACCOUNT_JSON: '{}',
    })

    expect(config.enabled).toBe(true)
    expect(config.endpointLocation).toBe('global')
  })

  it('returns disabled when NOTEBOOKLM is disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const result = await ensureYoutubeNotebookSource(
      { videoId: 'dQw4w9WgXcQ', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      {
        enabled: false,
        projectId: 'project-1',
        location: 'global',
        endpointLocation: 'global',
        notebookId: 'notebook-1',
        serviceAccountJson: '{}',
      },
    )

    expect(result.notebookSourceStatus).toBe('disabled')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns failed when project id is missing', async () => {
    const result = await ensureYoutubeNotebookSource(
      { videoId: 'dQw4w9WgXcQ', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      {
        enabled: true,
        projectId: '',
        location: 'global',
        endpointLocation: 'global',
        notebookId: 'notebook-1',
        serviceAccountJson: '{}',
      },
    )

    expect(result.notebookSourceStatus).toBe('failed')
    expect(result.notebookError).toContain('NOTEBOOKLM_PROJECT_ID')
  })

  it('links existing source when already present', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        sources: [
          {
            name: 'projects/p/locations/global/notebooks/nb/sources/source-123',
            metadata: {
              videoId: 'dQw4w9WgXcQ',
            },
          },
        ],
      }),
    )

    const result = await ensureYoutubeNotebookSource(
      { videoId: 'dQw4w9WgXcQ', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      {
        enabled: true,
        projectId: 'project-1',
        location: 'global',
        endpointLocation: 'global',
        notebookId: 'nb',
        serviceAccountJson: '{}',
      },
    )

    expect(result.notebookSourceStatus).toBe('linked')
    expect(result.notebookSourceId).toBe('source-123')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/sources?pageSize=100')
  })

  it('creates source when no existing source is found', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(asResponse(200, { sources: [] }))
      .mockResolvedValueOnce(
        asResponse(200, {
          sources: [{ name: 'projects/p/locations/global/notebooks/nb/sources/source-999' }],
        }),
      )

    const result = await ensureYoutubeNotebookSource(
      { videoId: 'dQw4w9WgXcQ', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      {
        enabled: true,
        projectId: 'project-1',
        location: 'global',
        endpointLocation: 'global',
        notebookId: 'nb',
        serviceAccountJson: '{}',
      },
    )

    expect(result.notebookSourceStatus).toBe('linked')
    expect(result.notebookSourceId).toBe('source-999')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const secondCall = fetchMock.mock.calls[1]
    expect(String(secondCall?.[0])).toContain('/sources:batchCreate')
    expect((secondCall?.[1] || {}).method).toBe('POST')
    const payload = JSON.parse(String((secondCall?.[1] || {}).body || '{}'))
    expect(payload.userContents[0].videoContent.url).toContain('youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('retries with youtubeUrl field when url field is rejected', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(asResponse(200, { sources: [] }))
      .mockResolvedValueOnce(
        asResponse(400, {
          error: {
            message: 'Invalid JSON payload received. Unknown name "url" at user_contents[0].video_content',
          },
        }),
      )
      .mockResolvedValueOnce(
        asResponse(200, {
          sources: [{ name: 'projects/p/locations/global/notebooks/nb/sources/source-777' }],
        }),
      )

    const result = await ensureYoutubeNotebookSource(
      { videoId: 'dQw4w9WgXcQ', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      {
        enabled: true,
        projectId: 'project-1',
        location: 'global',
        endpointLocation: 'global',
        notebookId: 'nb',
        serviceAccountJson: '{}',
      },
    )

    expect(result.notebookSourceStatus).toBe('linked')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const thirdPayload = JSON.parse(String((fetchMock.mock.calls[2]?.[1] || {}).body || '{}'))
    expect(thirdPayload.userContents[0].videoContent.youtubeUrl).toContain('youtube.com/watch?v=dQw4w9WgXcQ')
    expect(__mocks.getClient).toHaveBeenCalled()
  })
})
