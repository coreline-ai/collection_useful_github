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
import type { ThemeMode, TopSection } from '@shared/types'
import { resolveInitialTheme } from '@utils/theme'

export const AppShell = () => {
  const [activeTopSection, setActiveTopSection] = useState<TopSection>(() => loadTopSection() ?? 'github')
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => resolveInitialTheme(loadThemeMode()))

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

  return (
    <div className="app-shell">
      <TopSectionNav activeSection={activeTopSection} onChangeSection={setActiveTopSection} />

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
        />
      ) : null}
      {activeTopSection === 'youtube' ? <YoutubeFeatureEntry /> : null}
      {activeTopSection === 'bookmark' ? <BookmarkFeatureEntry /> : null}
    </div>
  )
}
