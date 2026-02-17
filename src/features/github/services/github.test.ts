import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchGithubSummaryStatus,
  fetchLatestCommitSha,
  fetchRepo,
  fetchRepoDetail,
  GitHubApiError,
  regenerateGithubSummary,
} from './github'

const asResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })

describe('github service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', 'http://localhost:4000')
    vi.stubEnv('VITE_POSTGRES_SYNC_API_TOKEN', 'test-admin-token')
  })

  it('maps repository payload to card', async () => {
    const readmeContent = btoa('# React\nA declarative UI library')

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        asResponse(200, {
          full_name: 'facebook/react',
          owner: { login: 'facebook' },
          name: 'react',
          description: 'React library',
          html_url: 'https://github.com/facebook/react',
          homepage: 'https://react.dev',
          language: 'TypeScript',
          stargazers_count: 1,
          forks_count: 2,
          subscribers_count: 3,
          open_issues_count: 4,
          topics: ['react'],
          license: { spdx_id: 'MIT', name: 'MIT License' },
          default_branch: 'main',
          created_at: '2026-02-16T00:00:00.000Z',
          updated_at: '2026-02-16T00:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(
        asResponse(200, {
          encoding: 'base64',
          content: readmeContent,
        }),
      )

    const result = await fetchRepo('facebook', 'react')

    expect(result.id).toBe('facebook/react')
    expect(result.owner).toBe('facebook')
    expect(result.repo).toBe('react')
    expect(result.watchers).toBe(3)
    expect(result.openIssues).toBe(4)
    expect(result.summary.length).toBeGreaterThan(0)
  })

  it('throws detail rate-limit message when readme/commit/issue all fail with 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(403, {
        message: 'API rate limit exceeded',
      }),
    )

    await expect(fetchRepoDetail('facebook', 'react')).rejects.toThrow(
      'GitHub API 요청 제한에 도달했습니다. `VITE_GITHUB_TOKEN`을 설정하면 README/Activity를 안정적으로 볼 수 있습니다.',
    )
  })

  it('maps timeout to GitHubApiError 408', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('aborted', 'AbortError'))

    try {
      await fetchRepo('facebook', 'react')
      throw new Error('expected to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubApiError)
      expect(error).toMatchObject({ status: 408 })
    }
  })

  it('returns latest commit sha when available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, [
        {
          sha: 'abc123',
        },
      ]),
    )

    await expect(fetchLatestCommitSha('facebook', 'react')).resolves.toBe('abc123')
  })

  it('requests github summary regeneration endpoint and maps response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        jobId: 12,
        summaryJobStatus: 'queued',
        summaryText: '기존 요약',
        summaryStatus: 'queued',
        summaryUpdatedAt: null,
        summaryProvider: 'none',
        summaryError: null,
      }),
    )

    const result = await regenerateGithubSummary('facebook/react', { force: true })

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:4000/api/github/summaries/regenerate',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(result.summaryJobStatus).toBe('queued')
    expect(result.summaryStatus).toBe('queued')
  })

  it('requests github summary status endpoint and maps response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        jobId: 12,
        summaryJobStatus: 'succeeded',
        summaryText: '새 요약',
        summaryStatus: 'ready',
        summaryUpdatedAt: '2026-01-01T00:00:00.000Z',
        summaryProvider: 'glm',
        summaryError: null,
      }),
    )

    const result = await fetchGithubSummaryStatus('facebook/react')
    expect(result.summaryText).toBe('새 요약')
    expect(result.summaryStatus).toBe('ready')
    expect(result.summaryProvider).toBe('glm')
  })

  it('normalizes queued summaryStatus to ready when job already succeeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        ok: true,
        jobId: 21,
        summaryJobStatus: 'succeeded',
        summaryText: '완료된 요약',
        summaryStatus: 'queued',
        summaryUpdatedAt: '2026-01-01T00:00:00.000Z',
        summaryProvider: 'glm',
        summaryError: null,
      }),
    )

    const result = await fetchGithubSummaryStatus('facebook/react')
    expect(result.summaryJobStatus).toBe('succeeded')
    expect(result.summaryStatus).toBe('ready')
    expect(result.summaryText).toBe('완료된 요약')
  })

  it('shows clear message when summary regenerate route is missing (HTML 404)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<pre>Cannot POST /api/github/summaries/regenerate</pre>', {
        status: 404,
        headers: {
          'Content-Type': 'text/html',
        },
      }),
    )

    await expect(regenerateGithubSummary('facebook/react', { force: true })).rejects.toThrow(
      '요약 API 경로를 찾지 못했습니다. 서버를 최신 버전으로 재기동해 주세요.',
    )
  })

  it('keeps backend message when repo card is not in remote dashboard (JSON 404)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(404, {
        ok: false,
        message: '대시보드에 등록된 GitHub 카드가 아닙니다.',
      }),
    )

    await expect(regenerateGithubSummary('facebook/react', { force: true })).rejects.toThrow(
      '대시보드에 등록된 GitHub 카드가 아닙니다.',
    )
  })

  it('maps generic JSON not-found 404 to route-missing guidance', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(404, {
        ok: false,
        message: 'not found',
      }),
    )

    await expect(regenerateGithubSummary('facebook/react', { force: true })).rejects.toThrow(
      '요약 API 경로를 찾지 못했습니다. 서버를 최신 버전으로 재기동해 주세요.',
    )
  })
})
