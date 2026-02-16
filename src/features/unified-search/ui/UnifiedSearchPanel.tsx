import type { ProviderType, UnifiedItem, UnifiedItemType } from '@shared/types'
import type { ReactNode } from 'react'
import type { RecentUnifiedSearchQuery } from '@features/unified-search/state/useUnifiedSearchState'

type UnifiedSearchPanelProps = {
  searchInput: string
  searchProvider: ProviderType | 'all'
  searchType: UnifiedItemType | 'all'
  searchLoading: boolean
  searchResults: UnifiedItem[]
  searchMessage: string | null
  onChangeSearchInput: (value: string) => void
  onChangeSearchProvider: (value: ProviderType | 'all') => void
  onChangeSearchType: (value: UnifiedItemType | 'all') => void
  onSearch: () => Promise<void>
  recentQueries: RecentUnifiedSearchQuery[]
  onSelectRecentQuery: (query: RecentUnifiedSearchQuery) => Promise<void>
  onClearRecentQueries: () => void
  toolbarActions?: ReactNode
}

export const UnifiedSearchPanel = ({
  searchInput,
  searchProvider,
  searchType,
  searchLoading,
  searchResults,
  searchMessage,
  onChangeSearchInput,
  onChangeSearchProvider,
  onChangeSearchType,
  onSearch,
  recentQueries,
  onSelectRecentQuery,
  onClearRecentQueries,
  toolbarActions,
}: UnifiedSearchPanelProps) => {
  return (
    <>
      <div className="global-data-toolbar" aria-label="통합 데이터 도구">
        <form
          className="global-search"
          onSubmit={(event) => {
            event.preventDefault()
            void onSearch()
          }}
        >
          <input
            type="text"
            value={searchInput}
            onChange={(event) => onChangeSearchInput(event.target.value)}
            placeholder="통합 검색: 저장소명, 요약, 태그"
            aria-label="통합 검색어"
          />
          <select
            aria-label="검색 provider"
            value={searchProvider}
            onChange={(event) => onChangeSearchProvider(event.target.value as ProviderType | 'all')}
          >
            <option value="all">전체 Provider</option>
            <option value="github">GitHub</option>
            <option value="youtube">YouTube</option>
            <option value="bookmark">Bookmark</option>
          </select>
          <select
            aria-label="검색 타입"
            value={searchType}
            onChange={(event) => onChangeSearchType(event.target.value as UnifiedItemType | 'all')}
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
        {toolbarActions}
      </div>

      <section className="search-method-summary" aria-label="검색 방식 요약">
        <h3>검색 방식 요약</h3>
        <ul>
          <li>기본 모드는 PostgreSQL relevance(관련도) 검색입니다.</li>
          <li>
            FTS(Full-Text Search, 전문 검색)는 tsvector(검색용 토큰 벡터)와 tsquery(질의)를 사용해 제목/요약/설명의
            의미 일치를 계산합니다.
          </li>
          <li>prefix(접두사) 매칭은 title이 검색어로 시작하는지 검사해 초반 입력 검색(예: rea)을 빠르게 맞춥니다.</li>
          <li>
            trigram(3글자 조각) 오탈자 보정은 similarity/word_similarity로 철자 오차(예: raect)까지 유사도를 계산합니다.
          </li>
          <li>최신성 보정(recency boost)은 updatedAt 기준으로 최근에 갱신된 항목에 가점을 부여합니다.</li>
          <li>최종 정렬은 score(종합 점수) 우선, 동점이면 updatedAt(최신 업데이트) 내림차순입니다.</li>
          <li>같은 조건 재검색은 메모리 TTL/LRU 캐시(60초, 최대 50개) 우선이며, 최근검색은 localStorage에 최대 20개 저장됩니다.</li>
        </ul>
      </section>

      {searchMessage ? <p className="global-message">{searchMessage}</p> : null}

      {recentQueries.length > 0 ? (
        <section className="recent-searches" aria-label="최근 검색어">
          <div className="recent-searches-header">
            <strong>최근 검색어</strong>
            <button type="button" onClick={onClearRecentQueries}>
              지우기
            </button>
          </div>
          <div className="recent-searches-list">
            {recentQueries.map((recentQuery) => (
              <button
                type="button"
                key={`${recentQuery.q}:${recentQuery.provider}:${recentQuery.type}`}
                onClick={() => {
                  void onSelectRecentQuery(recentQuery)
                }}
              >
                {recentQuery.q}
                <span>
                  {recentQuery.provider === 'all' ? '전체' : recentQuery.provider} ·{' '}
                  {recentQuery.type === 'all' ? '전체' : recentQuery.type}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

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
    </>
  )
}
