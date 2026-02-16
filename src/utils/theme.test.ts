import { describe, expect, it, vi } from 'vitest'
import { detectSystemTheme, resolveInitialTheme } from './theme'

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe('theme utils', () => {
  it('detects dark mode when media query matches', () => {
    mockMatchMedia(true)
    expect(detectSystemTheme()).toBe('dark')
  })

  it('detects light mode when media query does not match', () => {
    mockMatchMedia(false)
    expect(detectSystemTheme()).toBe('light')
  })

  it('returns stored mode when value exists', () => {
    mockMatchMedia(false)
    expect(resolveInitialTheme('dark')).toBe('dark')
    expect(resolveInitialTheme('light')).toBe('light')
  })

  it('falls back to system mode when stored value is null', () => {
    mockMatchMedia(true)
    expect(resolveInitialTheme(null)).toBe('dark')
  })
})
