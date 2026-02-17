# TRD: Unified Knowledge Cardboard

업데이트 기준: 2026-02-17

## 관련 문서

- `docs/PRD.md`
- `docs/PLAN.md`
- `docs/PLAN_EXTENTION1.md`
- `docs/WEBAPP_ESSENTIAL_CHECKLIST_PLAN.md`

## 1) 기술 스택

- Frontend: React 19, TypeScript, Vite 7
- Backend: Node.js (ESM), Express 4
- DB: PostgreSQL 16 (`pg`)
- Test: Vitest + Testing Library + Postgres E2E

## 2) 아키텍처

### 2.1 Frontend

- App Shell: `src/app/AppShell.tsx`
- Feature 분리:
  - `src/features/unified-search`
  - `src/features/github`
  - `src/features/youtube`
  - `src/features/bookmark`
- Data adapter: `src/core/data/adapters/remoteDb.ts`
- Local storage: `src/shared/storage/localStorage.ts`

### 2.2 Backend

- API entry: `server/src/index.js`
- 요약 서비스:
  - GitHub: `server/src/services/githubSummary*.js`
  - YouTube: `server/src/services/youtubeSummary*.js`
  - Bookmark: `server/src/services/bookmarkSummary*.js`
- NotebookLM:
  - `server/src/services/notebooklm.js`
  - `server/src/services/notebooklmCliAdapter.js`
- Schema: `server/db/schema.sql`

## 3) 모듈 경계

- `AppShell`은 탭/테마/동기화 상태 배지만 담당
- 도메인 로직은 feature entry 내부 캡슐화
- 공통 타입/계약은 `src/types.ts`, `src/core`, `src/shared`만 사용

## 4) 상태/동기화 설계

### 4.1 공통 동기화 상태

- `healthy`
- `retrying`
- `local`
- `recovered`

상태 배지: `src/shared/components/SyncStatusBadge.tsx`

### 4.2 관련 상수 (`src/constants.ts`)

- `REMOTE_SYNC_NETWORK_FAILURES_BEFORE_FALLBACK = 3`
- `REMOTE_SYNC_RECOVERY_INTERVAL_MS = 10000`
- `REMOTE_SYNC_RECOVERED_BADGE_MS = 4000`
- `REMOTE_SYNC_SAVE_DEBOUNCE_MS = 400`

## 5) 데이터 모델

타입 파일: `src/types.ts`

핵심 모델:

- `GitHubRepoCard`
- `YouTubeVideoCard`
- `BookmarkCard`
- `Category`
- `UnifiedItem`
- `SyncConnectionStatus`

요약 공통 상태 필드:

- `summaryText`
- `summaryStatus` (`idle|queued|ready|failed`)
- `summaryProvider` (`glm|none`)
- `summaryUpdatedAt`
- `summaryError`

## 6) DB 스키마

파일: `server/db/schema.sql`

### 6.1 핵심 테이블

- `unified_items`
- `unified_notes`
- `unified_meta`
- `github_dashboard_history`

### 6.2 요약 큐/캐시

- `github_summary_jobs`, `github_summary_cache`
- `youtube_summary_jobs`, `youtube_summary_cache`
- `bookmark_summary_jobs`, `bookmark_summary_cache`

### 6.3 검색 확장/인덱스

- extension: `pg_trgm`, `unaccent`
- GIN trigram 인덱스(lower title/summary/description/author/native_id)
- weighted FTS 인덱스(tsvector)

## 7) API 계약

### 7.1 상태/운영

- `GET /api/health`
- `GET /api/health/deep`
- `GET /api/search`
- `POST /api/rum/web-vitals`
- `GET /api/admin/rum/web-vitals/summary`
- `DELETE /api/admin/rum/web-vitals/samples`
- `GET /api/admin/export`
- `POST /api/admin/import`

### 7.2 Dashboard

- `GET/PUT /api/github/dashboard`
- `GET /api/github/dashboard/history`
- `POST /api/github/dashboard/rollback`
- `GET/PUT /api/youtube/dashboard`
- `GET/PUT /api/bookmark/dashboard`

### 7.3 Summary

- GitHub
  - `POST /api/github/summaries/regenerate`
  - `GET /api/github/summaries/status?repoId=...`
- YouTube
  - `POST /api/youtube/videos/:videoId/summarize`
  - `GET /api/youtube/summaries/:videoId/status`
  - `POST /api/youtube/summaries/:jobId/retry`
- Bookmark
  - `POST /api/bookmark/summaries/regenerate`
  - `GET /api/bookmark/summaries/status?bookmarkId=...`

### 7.4 Metadata/Utility

- `GET /api/youtube/videos/:videoId`
- `GET /api/bookmark/metadata?url=...`
- `GET /api/bookmark/link-check?url=...`
- `PUT /api/providers/:provider/snapshot`
- `GET /api/providers/:provider/items`
- `GET /api/items/:id`

## 8) 검색 설계

엔드포인트: `GET /api/search`

모드:

- `legacy`
- `relevance`(기본)

신호:

- exact
- prefix
- fts (`websearch_to_tsquery`)
- trigram (`similarity`, `word_similarity`)
- recency boost

가중치:

```text
score = exact*5.0 + prefix*2.5 + fts*1.8 + trgm*1.2 + recency*0.4
```

보호:

- search rate limit: IP 기준 60 req / 60 sec
- 클라이언트: recent query(20), result cache(TTL 60s, LRU 50)

## 9) 북마크 메타 추출 보안

- URL scheme 제한(`http/https`)
- credential 포함 URL 차단
- localhost/private 대역 차단(SSRF)
- redirect 최대 3회
- timeout/response bytes 제한
- 비HTML 응답 fallback

## 10) 요약 파이프라인

- 큐 기반 비동기 처리
- 상태 전이: `queued -> running -> succeeded/failed`
- 실패 시 기존 텍스트 보존
- 성공 시 `unified_items.summary` + `raw.card.summary*` 동시 반영

입력:

- GitHub: description + README(최대 바이트 제한)
- YouTube: title/channel/description/metrics
- Bookmark: title/excerpt/domain/url 메타

## 11) 테스트 전략

- 단위: parser/reducer/mapping/storage/services
- 통합: AppShell + feature 주요 플로우
- E2E: PostgreSQL roundtrip/search/snapshot

검증 명령:

- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run test:e2e:postgres`

## 12) 운영 리스크/대응

- 포트 충돌/구버전 서버: `dev:all`에서 4000 포트 정리
- 원격 장애: 재시도 후 로컬 전환 + 복구 루프
- 요약 404: API base URL/서버 버전/카드 등록 상태 점검
- 외부 API 장애(YouTube/GLM): 카드 저장 흐름과 요약 실패 분리
