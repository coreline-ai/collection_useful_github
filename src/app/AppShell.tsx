import { useEffect, useRef, useState } from 'react'
import {
  exportUnifiedBackup,
  importUnifiedBackup,
  isRemoteSnapshotEnabled,
  searchUnifiedItems,
} from '@core/data/adapters/remoteDb'
import { runInitialMigrations } from '@core/data/migration'
import { BookmarkFeatureEntry } from '@features/bookmark/entry'
import { GithubFeatureEntry } from '@features/github/entry'
import { YoutubeFeatureEntry } from '@features/youtube/entry'
import { TopSectionNav } from '@shared/components/TopSectionNav'
import {
  loadTopSection,
  loadThemeMode,
  saveTopSection,
  saveThemeMode,
} from '@shared/storage/localStorage'
import type { ProviderType, ThemeMode, TopSection, UnifiedItem, UnifiedItemType } from '@shared/types'
import { resolveInitialTheme } from '@utils/theme'

export const AppShell = () => {
  const remoteEnabled = isRemoteSnapshotEnabled()
  const [activeTopSection, setActiveTopSection] = useState<TopSection>(() => loadTopSection() ?? 'github')
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => resolveInitialTheme(loadThemeMode()))
  const [searchInput, setSearchInput] = useState('')
  const [searchProvider, setSearchProvider] = useState<ProviderType | 'all'>('all')
  const [searchType, setSearchType] = useState<UnifiedItemType | 'all'>('all')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<UnifiedItem[]>([])
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  const handleSearch = async () => {
    const query = searchInput.trim()

    if (!query) {
      setSearchResults([])
      setSearchMessage('검색어를 입력해 주세요.')
      return
    }

    if (!remoteEnabled) {
      setSearchResults([])
      setSearchMessage('통합 검색은 원격 DB 연결 시 활성화됩니다.')
      return
    }

    setSearchLoading(true)
    setSearchMessage(null)

    try {
      const items = await searchUnifiedItems({
        query,
        provider: searchProvider,
        type: searchType,
        limit: 40,
      })
      setSearchResults(items)
      setSearchMessage(items.length > 0 ? null : '검색 결과가 없습니다.')
    } catch (error) {
      setSearchResults([])
      setSearchMessage(error instanceof Error ? error.message : '통합 검색에 실패했습니다.')
    } finally {
      setSearchLoading(false)
    }
  }

  const handleExportBackup = async () => {
    if (!remoteEnabled) {
      setBackupMessage('원격 DB가 연결되지 않아 백업을 내보낼 수 없습니다.')
      return
    }

    setBackupLoading(true)
    setBackupMessage(null)

    try {
      const payload = await exportUnifiedBackup()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `unified-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      anchor.click()
      window.URL.revokeObjectURL(url)
      setBackupMessage('백업 파일을 다운로드했습니다.')
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : '백업 내보내기에 실패했습니다.')
    } finally {
      setBackupLoading(false)
    }
  }

  const handleImportBackupFile = async (file: File | null) => {
    if (!file) {
      return
    }

    if (!remoteEnabled) {
      setBackupMessage('원격 DB가 연결되지 않아 복원을 실행할 수 없습니다.')
      return
    }

    setBackupLoading(true)
    setBackupMessage(null)

    try {
      const text = await file.text()
      const payload = JSON.parse(text) as Parameters<typeof importUnifiedBackup>[0]
      await importUnifiedBackup(payload)
      setBackupMessage('백업 복원이 완료되었습니다. 화면을 새로고침합니다.')
      window.location.reload()
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : '백업 복원에 실패했습니다.')
    } finally {
      setBackupLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <div className="app-shell">
      <section className="global-data-toolbar" aria-label="통합 데이터 도구">
        <form
          className="global-search"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSearch()
          }}
        >
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="통합 검색: 저장소명, 요약, 태그"
            aria-label="통합 검색어"
          />
          <select
            aria-label="검색 provider"
            value={searchProvider}
            onChange={(event) => setSearchProvider(event.target.value as ProviderType | 'all')}
          >
            <option value="all">전체 Provider</option>
            <option value="github">GitHub</option>
            <option value="youtube">YouTube</option>
            <option value="bookmark">Bookmark</option>
          </select>
          <select
            aria-label="검색 타입"
            value={searchType}
            onChange={(event) => setSearchType(event.target.value as UnifiedItemType | 'all')}
          >
            <option value="all">전체 타입</option>
            <option value="repository">Repository</option>
            <option value="video">Video</option>
            <option value="bookmark">Bookmark</option>
          </select>
          <button type="submit" disabled={searchLoading}>
            {searchLoading ? '검색 중...' : '검색'}
          </button>
        </form>

        <div className="backup-tools">
          <button type="button" onClick={() => void handleExportBackup()} disabled={backupLoading}>
            백업 내보내기
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={backupLoading}>
            백업 복원
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null
              void handleImportBackupFile(file)
            }}
          />
        </div>
      </section>

      {searchMessage ? <p className="global-message">{searchMessage}</p> : null}
      {backupMessage ? <p className="global-message">{backupMessage}</p> : null}

      {searchResults.length > 0 ? (
        <section className="search-results" aria-live="polite">
          {searchResults.map((item) => (
            <article key={item.id} className="search-result-item">
              <div className="search-result-head">
                <strong>{item.title}</strong>
                <span>{item.provider} · {item.type}</span>
              </div>
              <p>{item.summary}</p>
              <a href={item.url} target="_blank" rel="noreferrer">
                원문 열기
              </a>
            </article>
          ))}
        </section>
      ) : null}

      <TopSectionNav activeSection={activeTopSection} onChangeSection={setActiveTopSection} />

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
