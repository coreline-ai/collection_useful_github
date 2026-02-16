import { describe, expect, it } from 'vitest'
import { pageCount, paginate } from './paginate'

describe('paginate', () => {
  it('returns items for the requested page', () => {
    const result = paginate(Array.from({ length: 13 }, (_, index) => index + 1), 2, 12)
    expect(result).toEqual([13])
  })

  it('returns empty array for invalid paging params', () => {
    expect(paginate([1, 2, 3], 0, 10)).toEqual([])
    expect(paginate([1, 2, 3], 1, 0)).toEqual([])
  })
})

describe('pageCount', () => {
  it('calculates minimum of one page', () => {
    expect(pageCount(0, 12)).toBe(1)
  })

  it('calculates pages from item count', () => {
    expect(pageCount(12, 12)).toBe(1)
    expect(pageCount(13, 12)).toBe(2)
  })
})
