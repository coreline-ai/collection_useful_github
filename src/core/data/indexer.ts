import type { UnifiedIndex, UnifiedItem } from '@shared/types'
import { createEmptyUnifiedIndex } from './schema'

const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu

const normalizeToken = (token: string): string => token.toLocaleLowerCase('ko-KR').trim()

export const tokenize = (value: string): string[] => {
  if (!value) {
    return []
  }

  const matches = value.match(TOKEN_PATTERN)
  if (!matches) {
    return []
  }

  return matches.map((token) => normalizeToken(token)).filter((token) => token.length > 1)
}

const unique = <T>(items: T[]): T[] => Array.from(new Set(items))

export const buildUnifiedIndex = (items: UnifiedItem[]): UnifiedIndex => {
  const index = createEmptyUnifiedIndex()

  const sortedByUpdated = [...items].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  for (const item of sortedByUpdated) {
    index.byProvider[item.provider].push(item.id)
    index.byType[item.type].push(item.id)
    index.byStatus[item.status].push(item.id)
    index.byUpdatedAtDesc.push(item.id)

    const tokenSource = [
      item.title,
      item.summary,
      item.description,
      item.tags.join(' '),
      item.author ?? '',
    ].join(' ')

    const tokens = unique(tokenize(tokenSource))

    for (const token of tokens) {
      const ids = index.tokenToIds[token] ?? []
      if (!ids.includes(item.id)) {
        index.tokenToIds[token] = [...ids, item.id]
      }
    }
  }

  return index
}

export const normalizeSearchToken = (token: string): string => normalizeToken(token)
