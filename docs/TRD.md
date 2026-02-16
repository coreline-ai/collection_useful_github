# TRD: GitHub 카드 대시보드

## 1. 기술 스택
- Frontend: React 19 + TypeScript + Vite
- 상태 관리: `useReducer` + local state/hooks
- 저장: `localStorage`
- 테스트: Vitest + Testing Library

## 2. 주요 모듈 구조
- `client/src/services/github.ts`
  - GitHub API 호출
  - 저장소 정보/README/활동 조회
  - 최신 커밋 SHA 조회 함수 제공
- `client/src/services/translation.ts`
  - 수동 번역 요청(버튼 트리거 시)
  - GLM 우선, OpenAI fallback
- `client/src/storage/localStorage.ts`
  - 카드/메모/카테고리/테마 저장
- `client/src/storage/detailCache.ts`
  - 상세 캐시 저장/조회/TTL 정리
- `client/src/features/youtube/services/youtube.ts`
  - YouTube URL 파서(`watch/youtu.be/shorts`)
  - 서버 경유 YouTube 메타 조회
- `client/src/features/youtube/state/dashboardReducer.ts`
  - YouTube 카드/카테고리/페이지네이션 상태 관리
- `client/src/features/youtube/entry.tsx`
  - YouTube 보드 UI(추가/검색/카테고리/카드)
- `client/src/utils/theme.ts`
  - OS 다크모드 감지
  - 저장값 + 시스템값 기반 초기 테마 결정
- `client/src/components/RepoDetailModal.tsx`
  - 상세 탭 UI
  - 수동 번역 버튼/원문 토글
  - 업데이트 확인/최신 갱신 버튼

## 3. 데이터 모델
### 3.1 카드
```ts
GitHubRepoCard {
  id, owner, repo, fullName, description, summary,
  htmlUrl, homepage, language,
  stars, forks, watchers, openIssues,
  topics, license, defaultBranch,
  createdAt, updatedAt, addedAt
}
```

### 3.2 상세
```ts
RepoDetailData {
  readmePreview: string | null
  recentActivity: RepoActivityItem[]
  latestCommitSha?: string | null
}
```

### 3.3 상세 캐시
```ts
RepoDetailCacheEntry {
  repoId: string
  cachedAt: string
  detail: RepoDetailData
}
```

### 3.4 테마
```ts
ThemeMode = 'light' | 'dark'
```

- 저장 키: `github_theme_mode_v1`
- 초기 로딩:
  1. 저장값 확인
  2. 저장값 없으면 `matchMedia('(prefers-color-scheme: dark)')` 확인
  3. 최종값을 `document.documentElement.dataset.theme`에 반영

## 4. 캐시 아키텍처
- 저장 키: `github_repo_detail_cache_v1`
- TTL: `DETAIL_CACHE_TTL_HOURS = 24`
- 로딩 순서:
  1. 모달 열림
  2. cache hit -> 즉시 렌더
  3. cache miss -> 원격 상세 조회 후 캐시 저장
- 수동 갱신:
  1. `업데이트 확인` -> `fetchLatestCommitSha()` 호출
  2. 캐시 SHA와 비교
  3. 다르면 `최신 데이터 불러오기` 노출

## 5. API 정책
- GitHub 헤더
  - `Accept: application/vnd.github+json`
  - `Authorization: Bearer ${VITE_GITHUB_TOKEN}` (옵션)
- 타임아웃
  - `VITE_GITHUB_TIMEOUT_SECONDS` (기본 12초)
- 환경변수
  - `VITE_GITHUB_TOKEN`
  - `VITE_GITHUB_TIMEOUT_SECONDS`
  - `GLM_API_KEY`, `GLM_BASE_URL`, `GLM_MODEL`, `GLM_TIMEOUT_SECONDS`
  - `VITE_OPENAI_API_KEY`, `VITE_OPENAI_MODEL`, `VITE_OPENAI_TIMEOUT_SECONDS`
  - `YOUTUBE_API_KEY` (server)
  - `YOUTUBE_API_TIMEOUT_SECONDS` (server)

### YouTube 서버 API
- `GET /api/youtube/videos/:videoId`
  - YouTube Data API v3 조회 후 카드 메타 반환
- `GET /api/youtube/dashboard`
  - YouTube 탭 카드/카테고리 스냅샷 로드
- `PUT /api/youtube/dashboard`
  - YouTube 탭 카드/카테고리 스냅샷 저장

## 6. 번역 동작
- 자동 번역 없음
- 탭별 버튼 클릭 시 호출
  - 개요: description + summary
  - README: markdown 본문
  - Activity: title 목록
- 토글 방식: 번역 결과 <-> 원문

## 7. 오류 처리
- GitHub 403 rate limit 발생 시 안내 메시지 노출
- 상세 API 3종(readme/commits/issues) 전부 실패 시 상세 에러 표출
- README가 없으면 안내 문구 표출

## 8. 테스트 범위
- URL 파서/페이지네이션/리듀서 단위 테스트
- 마크다운 렌더 및 sanitize 테스트
- 번역 서비스 fallback 테스트
- App 통합 테스트(등록/중복/상세/메모)
- YouTube 통합 테스트(탭 전환/영상 추가/로컬검색/카테고리)
- 테마 유틸 단위 테스트(저장값 우선/OS 감지)
- 테마 저장 유틸 테스트(localStorage 손상값 fallback)
- Postgres E2E(YouTube 카드 추가 후 `provider='youtube'` 영속화 검증)

## 9. 운영 가이드
- Rate limit 완화를 위해 `VITE_GITHUB_TOKEN` 설정 권장
- 키 노출 시 즉시 rotate
- 캐시 문제 확인 시 `localStorage`에서 관련 키 삭제 후 재실행
