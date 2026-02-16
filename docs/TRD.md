# TRD: Unified Knowledge Cardboard

업데이트 기준: 2026-02-16

## 1. 기술 스택

- Frontend: React 19, TypeScript, Vite 7
- Backend: Node.js(ESM) + Express 4
- Database: PostgreSQL 16 (`pg`)
- Testing: Vitest + Testing Library + Postgres E2E

## 2. 시스템 구성

- UI Shell: `src/app/AppShell.tsx`
- Feature Modules:
  - `src/features/github`
  - `src/features/youtube`
  - `src/features/bookmark`
  - `src/features/unified-search`
- Core Data Adapter: `src/core/data/adapters/remoteDb.ts`
- API Server: `server/src/index.js`
- DB Schema: `server/db/schema.sql`

## 3. 코드 레벨 구조

## 3.1 AppShell 레이어

책임:

- 탭 전환 상태(`TopSection`) 관리
- 테마 상태(`ThemeMode`) 관리
- 초기 데이터 마이그레이션 실행
- feature 별 sync badge 상태 연결

비책임:

- 카드 추가/삭제/검색 로직
- provider별 상세 상태 관리

## 3.2 Feature Entry 패턴

각 Entry(`github/youtube/bookmark`)는 동일 패턴을 가진다.

- `useReducer`로 대시보드 상태 관리
- `remoteEnabled` 시 원격 hydrate 실행
- 저장 시 원격 우선, 실패 시 localStorage fallback
- transient 실패 누적 후 `local` 전환
- 주기적 자동 복구(recovery loop)

공통 상수(`src/constants.ts`):

- `REMOTE_SYNC_NETWORK_FAILURES_BEFORE_FALLBACK = 3`
- `REMOTE_SYNC_RECOVERY_INTERVAL_MS = 10000`
- `REMOTE_SYNC_RECOVERED_BADGE_MS = 4000`

## 3.3 상태 모델

타입 파일: `src/types.ts`

핵심 타입:

- `GitHubRepoCard`
- `YouTubeVideoCard`
- `BookmarkCard`
- `Category`
- `UnifiedItem`
- `SyncConnectionStatus`

`BookmarkCard` 추가 필드:

- `metadataStatus`: 메타 추출 신뢰도
- `linkStatus`, `lastCheckedAt`, `lastStatusCode`, `lastResolvedUrl`: 링크 점검 결과 저장용

## 3.4 통합 데이터 계층

저장 대상 테이블:

- `unified_items`
- `unified_notes`
- `unified_meta`

보드별 대시보드 API:

- `GET/PUT /api/github/dashboard`
- `GET/PUT /api/youtube/dashboard`
- `GET/PUT /api/bookmark/dashboard`

Legacy 호환 API:

- `PUT /api/providers/:provider/snapshot`
- `GET /api/providers/:provider/items`
- `GET /api/items/:id`

## 4. PostgreSQL 스키마/인덱스

파일: `server/db/schema.sql`

확장:

- `pg_trgm`
- `unaccent`

테이블:

- `unified_items`: 통합 콘텐츠 본문
- `unified_notes`: 노트
- `unified_meta`: 대시보드/메타

검색 인덱스:

- trigram GIN: `title/summary/description/author/native_id(lower)`
- FTS GIN: 가중치 결합 `title/native_id(A), summary/author(B), description/tags(C)`
- 보조 정렬 인덱스: provider/type/status + updated_at

## 5. 검색 엔진 설계

엔드포인트: `GET /api/search`

모드:

- `legacy`: ILIKE 기반
- `relevance`(기본): 하이브리드 랭킹

신호:

- exact
- prefix
- fts
- trgm
- recency

랭킹 수식:

```text
score = exact*5.0 + prefix*2.5 + fts_rank*1.8 + trgm_similarity*1.2 + recency*0.4
```

옵션 파라미터:

- `provider`, `type`, `limit`
- `mode`, `fuzzy`, `prefix`, `min_score`

rate limit:

- IP 기준 `60 req / 60 sec`

클라이언트 최적화(`useUnifiedSearchState`):

- 최근검색 localStorage(최대 20)
- 결과 캐시 Map TTL 60초 + LRU 50개

## 6. Bookmark 메타 추출 설계

엔드포인트:

- `GET /api/bookmark/metadata?url=...`
- `GET /api/bookmark/link-check?url=...`

보안/안정성:

- URL 스킴 검증(`http/https`)
- 자격증명 포함 URL 거부
- localhost/private 대역 차단(SSRF 방어)
- redirect 최대 3회
- timeout/응답 바이트 제한
- non-html fallback

추출 우선순위:

- title: og > twitter > title
- excerpt: og desc > meta desc > first paragraph
- canonical/image/URL 정규화

## 7. YouTube 메타 설계

엔드포인트:

- `GET /api/youtube/videos/:videoId`

동작:

- YouTube Data API v3 `videos?part=snippet,statistics`
- quota/timeout/not found 메시지 분기
- `thumbnail`, `viewCount`, `likeCount` 매핑

## 8. 번역 설계

파일: `src/services/translation.ts`

정책:

- 자동 번역 없음, 버튼 트리거 수동 번역만
- GLM 우선, OpenAI fallback
- 배치 번역(JSON 응답 파싱)
- markdown 번역 시 구조 보존 지시

## 9. 테스트 전략

단위/통합:

- reducers, parsers, mapping, storage, markdown, theme
- App/AppShell 탭 전환 및 회귀
- unified-search state/cache/recent queries

Postgres E2E:

- `src/app/postgres*.e2e.test.ts(x)`
- 실행 스크립트: `npm run test:e2e:postgres`
- 전용 DB/포트 가드로 메인 DB 오염 방지

## 10. 운영 리스크와 대응

- CORS 불일치: `CORS_ORIGIN` 다중 포트 허용
- 원격 장애: local fallback + recovered 배지
- 검색 부하: SQL 인덱스 + API rate limit
- 북마크 크롤링 리스크: timeout/byte limit/SSRF 차단
