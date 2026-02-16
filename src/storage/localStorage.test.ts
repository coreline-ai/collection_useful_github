import { beforeEach, describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY, TOP_SECTION_STORAGE_KEY } from '../constants'
import { loadThemeMode, loadTopSection, saveThemeMode, saveTopSection } from './localStorage'

describe('localStorage theme mode', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('saves and loads theme mode', () => {
    saveThemeMode('dark')
    expect(loadThemeMode()).toBe('dark')
  })

  it('returns null for invalid stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'invalid')
    expect(loadThemeMode()).toBeNull()
  })
})

describe('localStorage top section', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('saves and loads top section', () => {
    saveTopSection('youtube')
    expect(loadTopSection()).toBe('youtube')
  })

  it('returns null for invalid top section value', () => {
    window.localStorage.setItem(TOP_SECTION_STORAGE_KEY, 'invalid')
    expect(loadTopSection()).toBeNull()
  })
})
