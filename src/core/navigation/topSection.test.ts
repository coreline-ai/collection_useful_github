import { describe, expect, it } from 'vitest'
import { TOP_SECTION_LABEL, TOP_SECTION_ORDER, isTopSection } from './topSection'

describe('topSection navigation config', () => {
  it('keeps stable section order for global tabs', () => {
    expect(TOP_SECTION_ORDER).toEqual(['search', 'github', 'youtube', 'bookmark'])
  })

  it('exposes human readable labels for each section', () => {
    expect(TOP_SECTION_LABEL.search).toBe('통합검색')
    expect(TOP_SECTION_LABEL.github).toBe('깃허브')
    expect(TOP_SECTION_LABEL.youtube).toBe('유튜브')
    expect(TOP_SECTION_LABEL.bookmark).toBe('북마크')
  })

  it('validates section value safely', () => {
    expect(isTopSection('search')).toBe(true)
    expect(isTopSection('github')).toBe(true)
    expect(isTopSection('youtube')).toBe(true)
    expect(isTopSection('bookmark')).toBe(true)
    expect(isTopSection('invalid')).toBe(false)
    expect(isTopSection(null)).toBe(false)
    expect(isTopSection(123)).toBe(false)
  })
})
