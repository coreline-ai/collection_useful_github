import { Suspense, lazy, useEffect, useState } from 'react'
import { runInitialMigrations } from '@core/data/migration'
import { TopSectionNav } from '@shared/components/TopSectionNav'
import {
  loadTopSection,
  loadThemeMode,
  saveTopSection,
  saveThemeMode,
} from '@shared/storage/localStorage'
import type { SyncConnectionStatus, ThemeMode, TopSection } from '@shared/types'
import { resolveInitialTheme } from '@utils/theme'

type SyncSnapshot = {
  status: SyncConnectionStatus
  lastSuccessAt: string | null
}

const INITIAL_SYNC_SNAPSHOT: SyncSnapshot = {
  status: 'healthy',
  lastSuccessAt: null,
}

const GithubFeatureEntry = lazy(async () => {
  const mod = await import('@features/github/entry')
  return { default: mod.GithubFeatureEntry }
})

const YoutubeFeatureEntry = lazy(async () => {
  const mod = await import('@features/youtube/entry')
  return { default: mod.YoutubeFeatureEntry }
})

const BookmarkFeatureEntry = lazy(async () => {
  const mod = await import('@features/bookmark/entry')
  return { default: mod.BookmarkFeatureEntry }
})

const UnifiedSearchFeatureEntry = lazy(async () => {
  const mod = await import('@features/unified-search/entry')
  return { default: mod.UnifiedSearchFeatureEntry }
})

export const AppShell = () => {
  const [activeTopSection, setActiveTopSection] = useState<TopSection>(() => loadTopSection() ?? 'github')
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => resolveInitialTheme(loadThemeMode()))
  const [mountedSearchPanel, setMountedSearchPanel] = useState(activeTopSection === 'search')
  const [githubSync, setGithubSync] = useState<SyncSnapshot>(INITIAL_SYNC_SNAPSHOT)
  const [youtubeSync, setYoutubeSync] = useState<SyncSnapshot>(INITIAL_SYNC_SNAPSHOT)
  const [bookmarkSync, setBookmarkSync] = useState<SyncSnapshot>(INITIAL_SYNC_SNAPSHOT)

  useEffect(() => {
    runInitialMigrations()
  }, [])

  useEffect(() => {
    saveTopSection(activeTopSection)
  }, [activeTopSection])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    saveThemeMode(themeMode)
  }, [themeMode])

  const handleChangeSection = (section: TopSection) => {
    if (section === 'search') {
      setMountedSearchPanel(true)
    }
    setActiveTopSection(section)
  }

  const activeSync =
    activeTopSection === 'github'
      ? githubSync
      : activeTopSection === 'youtube'
        ? youtubeSync
        : activeTopSection === 'bookmark'
          ? bookmarkSync
          : null

  return (
    <div className="app-shell">
      <h1 className="sr-only">Collection Useful Hub Dashboard</h1>
      <TopSectionNav
        activeSection={activeTopSection}
        onChangeSection={handleChangeSection}
        syncStatus={activeSync?.status}
        lastSyncSuccessAt={activeSync?.lastSuccessAt}
      />

      {mountedSearchPanel ? (
        <section
          className="top-section-panel"
          hidden={activeTopSection !== 'search'}
          aria-hidden={activeTopSection !== 'search'}
        >
          <Suspense fallback={<div className="feature-loading">통합검색 화면 로딩 중...</div>}>
            <UnifiedSearchFeatureEntry />
          </Suspense>
        </section>
      ) : null}

      {activeTopSection === 'github' ? (
        <Suspense fallback={<div className="feature-loading">GitHub 화면 로딩 중...</div>}>
          <GithubFeatureEntry
            themeMode={themeMode}
            onToggleTheme={() => setThemeMode((current) => (current === 'light' ? 'dark' : 'light'))}
            onSyncStatusChange={setGithubSync}
          />
        </Suspense>
      ) : null}
      {activeTopSection === 'youtube' ? (
        <Suspense fallback={<div className="feature-loading">YouTube 화면 로딩 중...</div>}>
          <YoutubeFeatureEntry
            themeMode={themeMode}
            onToggleTheme={() => setThemeMode((current) => (current === 'light' ? 'dark' : 'light'))}
            onSyncStatusChange={setYoutubeSync}
          />
        </Suspense>
      ) : null}
      {activeTopSection === 'bookmark' ? (
        <Suspense fallback={<div className="feature-loading">북마크 화면 로딩 중...</div>}>
          <BookmarkFeatureEntry
            themeMode={themeMode}
            onToggleTheme={() => setThemeMode((current) => (current === 'light' ? 'dark' : 'light'))}
            onSyncStatusChange={setBookmarkSync}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
