import type { ThemeMode } from '../types'

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export const detectSystemTheme = (): ThemeMode => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }

  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light'
}

export const resolveInitialTheme = (stored: ThemeMode | null): ThemeMode => {
  if (stored) {
    return stored
  }

  return detectSystemTheme()
}
