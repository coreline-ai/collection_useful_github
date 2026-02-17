# TRD: Unified Knowledge Cardboard

업데이트 기준: 2026-02-17

## 관련 문서

- [WEBAPP ESSENTIAL CHECKLIST + 실행 계획](./WEBAPP_ESSENTIAL_CHECKLIST_PLAN.md)
- [PRD](./PRD.md)
- [DB Backup/Restore Runbook](./DB_BACKUP_RESTORE_RUNBOOK.md)
- [Release/Rollback Runbook](./RELEASE_ROLLBACK_RUNBOOK.md)
- [Browser/Mobile QA Checklist](./QA_BROWSER_MOBILE_CHECKLIST.md)

## 1. 기술 스택

- Frontend: React 19, TypeScript, Vite 7
- Backend: Node.js(ESM), Express 4
- Database: PostgreSQL 16 (`pg`)
- Test: Vitest + Testing Library + Postgres E2E

## 2. 시스템 아키텍처

## 2.1 Frontend

- App Shell: `src/app/AppShell.tsx`
- Feature Modules:
  - `src/features/unified-search`
  - `src/features/github`
  - `src/features/youtube`
  - `src/features/bookmark`
- Data Adapter: `src/core/data/adapters/remoteDb.ts`
- Local Storage Adapter: `src/shared/storage/localStorage.ts`

## 2.2 Backend

- API: `server/src/index.js`
- Summary Services:
  - GitHub: `server/src/services/githubSummary*.js`
  - YouTube: `server/src/services/youtubeSummary*.js`
  - Bookmark: `server/src/services/bookmarkSummary*.js`
- NotebookLM Adapter: `server/src/services/notebooklm*.js`
- Schema: `server/db/schema.sql`

## 3. 모듈 경계 원칙

- AppShell은 탭/테마/초기화/공통 상태 표시만 담당
- 카드 도메인 로직은 각 feature entry 내부에서 캡슐화
- provider 간 직접 참조 최소화, 공통 계약은 `types/core adapter`로 연결

## 4. 상태/동기화 설계

## 4.1 Feature Entry 공통 패턴

- `useReducer` 기반 상태 관리
- 원격 hydrate 성공 시 원격 기준 스냅샷 사용
- 저장 시 원격 우선, 네트워크 오류 시 로컬 fallback
- 복구 루프 기반 자동 재연결

핵심 상수(`src/constants.ts`):

- `REMOTE_SYNC_NETWORK_FAILURES_BEFORE_FALLBACK = 3`
- `REMOTE_SYNC_RECOVERY_INTERVAL_MS = 10000`
- `REMOTE_SYNC_RECOVERED_BADGE_MS = 4000`

## 4.2 동기화 상태

- `healthy`
- `retrying`
- `local`
- `recovered`

상태 배지는 AppShell 상단에 노출되며 마지막 성공 시각을 함께 표시한다.

## 5. 데이터 모델

타입 파일: `src/types.ts`

핵심 모델:

- `GitHubRepoCard`
- `YouTubeVideoCard`
- `BookmarkCard`
- `Category`
- `UnifiedItem`
- `SyncConnectionStatus`

요약 관련 공통 상태 필드:

- `summaryText`
- `summaryStatus` (`idle|queued|ready|failed`)
- `summaryProvider` (`glm|none`)
- `summaryUpdatedAt`
- `summaryError`

## 6. DB 스키마

파일: `server/db/schema.sql`

## 6.1 기본 테이블

- `unified_items`
- `unified_notes`
- `unified_meta`
- `github_dashboard_history`

## 6.2 요약 큐/캐시 테이블

- `github_summary_jobs`
- `github_summary_cache`
- `youtube_summary_jobs`
- `youtube_summary_cache`
- `bookmark_summary_jobs`
- `bookmark_summary_cache`

## 6.3 인덱스/검색 확장

- extension: `pg_trgm`, `unaccent`
- trigram GIN(lower title/summary/description/author/native_id)
- FTS GIN(weighted tsvector)
- provider/type/status/updated_at 보조 인덱스

## 7. API 설계

## 7.1 공통

- `GET /api/health`
- `GET /api/health/deep`
- `GET /api/search`
- `GET /api/admin/export`
- `POST /api/admin/import`

## 7.2 Dashboard

- `GET/PUT /api/github/dashboard`
- `GET/PUT /api/youtube/dashboard`
- `GET/PUT /api/bookmark/dashboard`

## 7.3 Summary

- GitHub:
  - `POST /api/github/summaries/regenerate`
  - `GET /api/github/summaries/status?repoId=...`
- YouTube:
  - `POST /api/youtube/videos/:videoId/summarize`
  - `GET /api/youtube/summaries/:videoId/status`
  - `POST /api/youtube/summaries/:jobId/retry`
- Bookmark:
  - `POST /api/bookmark/summaries/regenerate`
  - `GET /api/bookmark/summaries/status?bookmarkId=...`

## 7.4 Metadata/Utility

- `GET /api/youtube/videos/:videoId`
- `GET /api/bookmark/metadata?url=...`
- `GET /api/bookmark/link-check?url=...`
- `PUT /api/providers/:provider/snapshot`
- `GET /api/providers/:provider/items`
- `GET /api/items/:id`

## 8. 검색 엔진 상세

엔드포인트: `GET /api/search`

모드:

- `legacy`: 단순 ILIKE 계열
- `relevance`(기본): 하이브리드 랭킹

신호:

- exact
- prefix
- fts (`tsvector`, `websearch_to_tsquery`)
- trgm (`similarity`, `word_similarity`)
- recency boost

대표 수식:

```text
score = exact*5.0 + prefix*2.5 + fts*1.8 + trgm*1.2 + recency*0.4
```

서버 보호:

- rate limit: IP 기준 60 req / 60 sec

클라이언트 최적화:

- 최근검색 localStorage(최대 20개)
- 결과 캐시 메모리 TTL 60초 + LRU 50개

## 9. 북마크 메타 추출/보안

엔드포인트:

- `GET /api/bookmark/metadata`
- `GET /api/bookmark/link-check`

보안/안정성:

- URL 스킴 검증(`http/https`)
- credential 포함 URL 거부
- localhost/private 대역 차단(SSRF)
- redirect 최대 3회
- timeout + 최대 바이트 제한
- 비HTML 응답 fallback 처리

## 10. 요약 파이프라인

요약 생성(3 provider 공통):

- 큐 기반 비동기 처리
- 상태 전이: `queued -> running -> succeeded/failed`
- 실패 시 기존 카드 텍스트 보존
- 성공 시 `unified_items.summary` + `raw.card.summary*` 동시 갱신

입력 원문:

- GitHub: description + README(최대 바이트 제한)
- YouTube: title/channel/description/metrics
- Bookmark: title/excerpt/domain/url 메타 기반

## 11. 테스트 전략

- 단위: reducer/parser/mapping/storage/services
- 통합: AppShell/각 feature 주요 사용자 플로우
- Postgres E2E: 저장-복원-검색 라운드트립

명령:

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e:postgres`

## 12. 운영 리스크 및 대응

- 포트 충돌/구버전 서버 잔존:
  - `dev:all`에서 4000 포트 기존 서버 정리 후 재기동
- 원격 연결 장애:
  - 재시도 후 로컬 전환, 복구 루프로 정상화
- 요약 재생성 404:
  - API base URL/서버 버전/카드 등록 상태 점검
- YouTube quota/외부 API 장애:
  - 카드 저장 흐름과 요약 실패를 분리 처리
