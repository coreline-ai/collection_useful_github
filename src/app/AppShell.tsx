import { useEffect, useState } from 'react'
import { runInitialMigrations } from '@core/data/migration'
import { BookmarkFeatureEntry } from '@features/bookmark/entry'
import { GithubFeatureEntry } from '@features/github/entry'
import { UnifiedSearchFeatureEntry } from '@features/unified-search/entry'
import { YoutubeFeatureEntry } from '@features/youtube/entry'
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

export const AppShell = () => {
  const [activeTopSection, setActiveTopSection] = useState<TopSection>(() => loadTopSection() ?? 'github')
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => resolveInitialTheme(loadThemeMode()))
  const [githubSync, setGithubSync] = useState<SyncSnapshot>(INITIAL_SYNC_SNAPSHOT)
  const [youtubeSync, setYoutubeSync] = useState<SyncSnapshot>(INITIAL_SYNC_SNAPSHOT)

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

  const activeSync = activeTopSection === 'github' ? githubSync : activeTopSection === 'youtube' ? youtubeSync : null

  return (
    <div className="app-shell">
      <TopSectionNav
        activeSection={activeTopSection}
        onChangeSection={setActiveTopSection}
        syncStatus={activeSync?.status}
        lastSyncSuccessAt={activeSync?.lastSuccessAt}
      />

      <section
        className="top-section-panel"
        hidden={activeTopSection !== 'search'}
        aria-hidden={activeTopSection !== 'search'}
      >
        <UnifiedSearchFeatureEntry />
      </section>

      {activeTopSection === 'github' ? (
        <GithubFeatureEntry
          themeMode={themeMode}
          onToggleTheme={() => setThemeMode((current) => (current === 'light' ? 'dark' : 'light'))}
          onSyncStatusChange={setGithubSync}
        />
      ) : null}
      {activeTopSection === 'youtube' ? (
        <YoutubeFeatureEntry
          themeMode={themeMode}
          onToggleTheme={() => setThemeMode((current) => (current === 'light' ? 'dark' : 'light'))}
          onSyncStatusChange={setYoutubeSync}
        />
      ) : null}
      {activeTopSection === 'bookmark' ? <BookmarkFeatureEntry /> : null}
    </div>
  )
}
