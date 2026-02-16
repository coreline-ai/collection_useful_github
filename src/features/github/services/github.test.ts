import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubApiError, searchPublicRepos } from './github'

const asResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })

describe('github search service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('maps GitHub public search response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(200, {
        total_count: 34,
        items: [
          {
            full_name: 'facebook/react',
            owner: { login: 'facebook' },
            name: 'react',
            description: 'React library',
            html_url: 'https://github.com/facebook/react',
            language: 'TypeScript',
            stargazers_count: 1,
            forks_count: 1,
            updated_at: '2026-02-16T00:00:00.000Z',
            topics: ['react'],
          },
        ],
      }),
    )

    const result = await searchPublicRepos('react', 2, 12)

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0] ?? '')
    expect(requestedUrl).toContain('/search/repositories?')
    expect(requestedUrl).toContain('q=react+in%3Aname%2Cdescription')
    expect(requestedUrl).toContain('sort=stars')
    expect(requestedUrl).toContain('order=desc')
    expect(requestedUrl).toContain('page=2')
    expect(requestedUrl).toContain('per_page=12')
    expect(result.totalCount).toBe(34)
    expect(result.page).toBe(2)
    expect(result.hasNextPage).toBe(true)
    expect(result.items[0]?.id).toBe('facebook/react')
  })

  it('throws rate limit message on 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(403, {
        message: 'API rate limit exceeded',
      }),
    )

    await expect(searchPublicRepos('react', 1, 12)).rejects.toThrow(
      'GitHub API 요청 제한에 도달했습니다. VITE_GITHUB_TOKEN 설정을 권장합니다.',
    )
  })

  it('throws validation message on 422', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      asResponse(422, {
        message: 'Validation Failed',
      }),
    )

    await expect(searchPublicRepos('!', 1, 12)).rejects.toThrow('검색어가 유효하지 않습니다.')
  })

  it('maps timeout abort to GitHubApiError 408', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('aborted', 'AbortError'))

    try {
      await searchPublicRepos('react', 1, 12)
      throw new Error('expected to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubApiError)
      expect(error).toMatchObject({ status: 408 })
    }
  })
})
