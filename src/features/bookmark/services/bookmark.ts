import { DEFAULT_MAIN_CATEGORY_ID } from '@constants'
import type { BookmarkCard } from '@shared/types'
import {
  fetchBookmarkMetadata as fetchBookmarkMetadataFromRemote,
  type BookmarkCardDraft,
} from '@core/data/adapters/remoteDb'

const MARKETING_QUERY_KEYS = new Set(['fbclid', 'gclid'])

const removeTrackingParams = (url: URL): void => {
  const keys = Array.from(url.searchParams.keys())
  keys.forEach((key) => {
    const lower = key.toLocaleLowerCase('en-US')
    if (lower.startsWith('utm_') || MARKETING_QUERY_KEYS.has(lower)) {
      url.searchParams.delete(key)
    }
  })
}

const sortQueryParams = (url: URL): void => {
  if (!url.search || url.search.length <= 1) {
    return
  }

  const params = new URLSearchParams(url.search)
  params.sort()
  const sorted = params.toString()
  url.search = sorted ? `?${sorted}` : ''
}

export const parseBookmarkUrl = (input: string): { url: string; normalizedUrl: string; domain: string } | null => {
  const raw = input.trim()
  if (!raw) {
    return null
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return null
  }

  let candidate = raw
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }

  if (url.username || url.password) {
    return null
  }

  url.hostname = url.hostname.toLocaleLowerCase('en-US')
  url.hash = ''
  removeTrackingParams(url)
  sortQueryParams(url)

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '')
    if (!url.pathname) {
      url.pathname = '/'
    }
  }

  const normalizedUrl = url.toString().replace(/\?$/, '')
  const domain = url.hostname.replace(/^www\./, '')

  return {
    url: normalizedUrl,
    normalizedUrl,
    domain,
  }
}

export const fetchBookmarkMetadata = async (url: string): Promise<BookmarkCardDraft> => {
  return fetchBookmarkMetadataFromRemote(url)
}

export const createBookmarkCardFromDraft = (draft: BookmarkCardDraft): BookmarkCard => ({
  ...draft,
  categoryId: DEFAULT_MAIN_CATEGORY_ID,
  addedAt: new Date().toISOString(),
})
