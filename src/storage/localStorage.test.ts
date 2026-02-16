import { beforeEach, describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY } from '../constants'
import { loadThemeMode, saveThemeMode } from './localStorage'

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
