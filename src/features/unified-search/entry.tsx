import { BackupTools } from '@features/unified-search/ui/BackupTools'
import { UnifiedSearchPanel } from '@features/unified-search/ui/UnifiedSearchPanel'
import { useUnifiedSearchState } from '@features/unified-search/state/useUnifiedSearchState'
import './ui/UnifiedSearch.css'

export const UnifiedSearchFeatureEntry = () => {
  const {
    searchInput,
    searchProvider,
    searchType,
    searchLoading,
    searchResults,
    searchMessage,
    recentQueries,
    backupLoading,
    backupMessage,
    importInputRef,
    setSearchInput,
    setSearchProvider,
    setSearchType,
    handleSearch,
    handleSelectRecentQuery,
    handleClearRecentQueries,
    handleExportBackup,
    handleImportBackupFile,
  } = useUnifiedSearchState()

  return (
    <section className="unified-search-feature" aria-label="통합검색">
      <UnifiedSearchPanel
        searchInput={searchInput}
        searchProvider={searchProvider}
        searchType={searchType}
        searchLoading={searchLoading}
        searchResults={searchResults}
        searchMessage={searchMessage}
        onChangeSearchInput={setSearchInput}
        onChangeSearchProvider={setSearchProvider}
        onChangeSearchType={setSearchType}
        onSearch={handleSearch}
        recentQueries={recentQueries}
        onSelectRecentQuery={handleSelectRecentQuery}
        onClearRecentQueries={handleClearRecentQueries}
        toolbarActions={
          <BackupTools
            loading={backupLoading}
            importInputRef={importInputRef}
            onExportBackup={handleExportBackup}
            onImportBackupFile={handleImportBackupFile}
          />
        }
      />

      {backupMessage ? <p className="global-message">{backupMessage}</p> : null}
    </section>
  )
}
