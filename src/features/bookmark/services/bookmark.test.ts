import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchBookmarkMetadata, parseBookmarkUrl } from './bookmark'

vi.mock('@core/data/adapters/remoteDb', () => ({
  fetchBookmarkMetadata: vi.fn(),
}))

const { fetchBookmarkMetadata: fetchBookmarkMetadataFromRemote } = await import('@core/data/adapters/remoteDb')

describe('bookmark service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes bookmark url and removes tracking params/hash', () => {
    const parsed = parseBookmarkUrl(
      'https://WWW.Example.com/path/to/page/?utm_source=abc&x=1&fbclid=zzz#section',
    )

    expect(parsed).toEqual({
      url: 'https://www.example.com/path/to/page?x=1',
      normalizedUrl: 'https://www.example.com/path/to/page?x=1',
      domain: 'example.com',
    })
  })

  it('normalizes query parameter order for duplicate-safe comparison', () => {
    const parsed = parseBookmarkUrl('https://example.com/path?b=2&a=1&utm_source=abc')
    expect(parsed?.normalizedUrl).toBe('https://example.com/path?a=1&b=2')
  })

  it('rejects invalid url', () => {
    expect(parseBookmarkUrl('')).toBeNull()
    expect(parseBookmarkUrl('file:///etc/passwd')).toBeNull()
    expect(parseBookmarkUrl('https://user:pass@example.com/path')).toBeNull()
    expect(parseBookmarkUrl('not a url')).toBeNull()
  })

  it('fetches bookmark metadata', async () => {
    vi.mocked(fetchBookmarkMetadataFromRemote).mockResolvedValue({
      id: 'https://example.com/post',
      url: 'https://example.com/post',
      normalizedUrl: 'https://example.com/post',
      canonicalUrl: null,
      domain: 'example.com',
      title: 'Post title',
      excerpt: 'Post excerpt',
      thumbnailUrl: null,
      faviconUrl: 'https://example.com/favicon.ico',
      tags: ['post'],
      metadataStatus: 'ok',
      updatedAt: '2026-02-16T00:00:00.000Z',
    })

    const metadata = await fetchBookmarkMetadata('https://example.com/post')

    expect(fetchBookmarkMetadataFromRemote).toHaveBeenCalledTimes(1)
    expect(fetchBookmarkMetadataFromRemote).toHaveBeenCalledWith('https://example.com/post')
    expect(metadata.title).toBe('Post title')
    expect(metadata.domain).toBe('example.com')
    expect(metadata.metadataStatus).toBe('ok')
  })
})
