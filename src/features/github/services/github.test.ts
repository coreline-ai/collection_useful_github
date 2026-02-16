import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchLatestCommitSha, fetchRepo, fetchRepoDetail, GitHubApiError } from './github'

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
})
