# Useful Git Info

<p align="left">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" />
  <img alt="Vite 7" src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" />
  <img alt="Node 20+" src="https://img.shields.io/badge/Node-20+-339933?logo=node.js&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" />
  <img alt="Vitest" src="https://img.shields.io/badge/Tested_with-Vitest-6E9F18?logo=vitest&logoColor=white" />
</p>

GitHub, YouTube, Bookmark를 카드보드로 관리하고, PostgreSQL 통합 인덱스 기반 검색을 제공하는 단일 웹앱입니다.

## 1. 핵심 요약

- 최상단 탭: `통합검색 > 깃허브 > 유튜브 > 북마크`
- 각 탭은 기능 모듈(`src/features/*`)로 분리
- 모든 데이터는 서버의 `unified_items / unified_notes / unified_meta`로 정규화 저장
- 각 보드는 원격 저장 실패 시 로컬 저장으로 자동 전환 후 재복구 시도
- 통합검색은 PostgreSQL `FTS + prefix + trigram + recency` 하이브리드 랭킹 사용

## 2. 사용자 기능

### 2.1 GitHub 보드

- 저장소 URL/`owner/repo` 입력으로 카드 추가
- 메인/창고/사용자 카테고리 관리
- 카드 이동/삭제, 4열(데스크톱)/12개 페이지네이션
- 등록 카드 로컬 검색(메인에서만 노출, 검색 시 전체 카테고리 통합 검색)
- 상세 모달:
  - 탭: `개요 / README / Activity`
  - 메모 작성/저장
  - 수동 번역(자동 번역 없음)

### 2.2 YouTube 보드

- 영상 URL(`watch`, `youtu.be`, `shorts`)로 카드 추가
- 카드: 썸네일, 제목, 채널, 조회수, 게시일, 링크, 요약 상태/요약 텍스트
- 요약 생성:
  - 카드 추가 직후 비동기 요약 생성 요청
  - 기본 엔진: GLM (`YOUTUBE_SUMMARY_PROVIDER=glm`)
  - 실패 시 카드는 유지되고 요약만 `실패` 상태 표시 + `요약 재생성` 가능
- NotebookLM 소스 연동 상태:
  - `NOTEBOOKLM_ENABLED=true`일 때 실제 NotebookLM REST(`sources list/create`) 호출
  - 기본 `disabled` (호출 없이 안전 스킵)
  - 권한/토큰 실패 시 카드 저장은 유지되고 source 상태만 `failed`
- 상세 모달 없음(카드에서 바로 링크 이동)
- GitHub와 동일한 보드 UX(카테고리/검색/페이지네이션/이동/삭제)

### 2.3 Bookmark 보드

- URL(`http/https`) 입력으로 메타데이터 추출 후 카드 추가
- 카드: 제목, excerpt, 도메인, 링크, 추가일
- 메타 추출 실패 시 `fallback` 카드 생성(추가 차단하지 않음)
- 중복 정리 도우미:
  - 그룹 기준: `resolved URL`, `canonical URL`, `내용 유사`
  - 그룹 단위 병합(유지 카드 1개 + 나머지 삭제)

### 2.4 통합검색

- provider/type 필터 + 최근검색 + 백업 내보내기/복원
- 검색 결과는 `UnifiedItem` 공통 모델로 표시

## 3. 코드 레벨 상세 분석

## 3.1 AppShell 책임 분리

- 파일: `src/app/AppShell.tsx`
- 책임:
  - 탭 상태(`TopSection`) 및 테마 상태(`ThemeMode`) 관리
  - 초기 마이그레이션 실행(`runInitialMigrations()`)
  - 각 feature entry 렌더링
  - 탭별 동기화 상태 배지 연결
- 원칙:
  - AppShell은 기능 상세 로직을 가지지 않음
  - 비즈니스 로직은 feature 내부 reducer/hook/service로 캡슐화

## 3.2 Feature 경계

- GitHub: `src/features/github/*`
- YouTube: `src/features/youtube/*`
- Bookmark: `src/features/bookmark/*`
- Unified Search: `src/features/unified-search/*`

각 feature entry 공통 패턴:

- `useReducer` 기반 대시보드 상태
- 원격 로드(hydrate) -> 원격 저장 -> 실패 시 로컬 전환
- 재시도 임계치(`REMOTE_SYNC_NETWORK_FAILURES_BEFORE_FALLBACK`) 초과 시 `local`
- 주기적 복구 시도(`REMOTE_SYNC_RECOVERY_INTERVAL_MS`)

동기화 상태 값(`SyncConnectionStatus`):

- `healthy`: 정상
- `retrying`: 네트워크 재시도 중
- `local`: 로컬 전환
- `recovered`: 복구 완료(짧은 시간 표시 후 healthy 복귀)

## 3.3 데이터 모델

핵심 타입은 `src/types.ts` 기준.

```ts
type ProviderType = 'github' | 'youtube' | 'bookmark'
type UnifiedItemType = 'repository' | 'video' | 'bookmark'

type UnifiedItem = {
  id: string
  provider: ProviderType
  type: UnifiedItemType
  nativeId: string
  title: string
  summary: string
  description: string
  url: string
  tags: string[]
  author: string | null
  language: string | null
  metrics: {
    stars?: number
    forks?: number
    watchers?: number
    views?: number
    likes?: number
  }
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
  savedAt: string
  raw: Record<string, unknown>
  score?: number
  matchedBy?: Array<'exact' | 'prefix' | 'fts' | 'trgm'>
}
```

## 3.4 로컬 저장 키

- GitHub: `github_cards_v1`, `github_notes_v1`, `github_categories_v1`, `github_selected_category_v1`
- YouTube: `youtube_cards_v1`, `youtube_categories_v1`, `youtube_selected_category_v1`
- Bookmark: `bookmark_cards_v1`, `bookmark_categories_v1`, `bookmark_selected_category_v1`
- 공통: `top_section_v1`, `github_theme_mode_v1`, `unified_recent_queries_v1`

## 3.5 통합검색 알고리즘 (현 구현)

서버 파일: `server/src/index.js` (`GET /api/search`)
DB 인덱스: `server/db/schema.sql`

검색 신호:

- `exact`: title/native_id/author 정확 일치
- `prefix`: 정규화된 prefix 일치
- `fts`: `tsvector + websearch_to_tsquery` 전문 검색
- `trgm`: `similarity + word_similarity` 오탈자 보정
- `recency`: 최근 업데이트 가점

랭킹:

```text
score =
  exact*5.0 +
  prefix*2.5 +
  fts_rank*1.8 +
  trgm_similarity*1.2 +
  recency_boost*0.4
```

정렬:

- `ORDER BY score DESC, updated_at DESC`

짧은 검색어 노이즈 제어:

- 길이 >= 4: typo threshold 0.1
- 길이 2~3: typo threshold 0.16
- 길이 1: trigram 실질 비활성

클라이언트 최적화(`src/features/unified-search/state/useUnifiedSearchState.ts`):

- 최근검색: localStorage 최대 20개
- 결과 캐시: 메모리 TTL(60초) + LRU(최대 50개)
- 캐시 키: `query/provider/type/limit/mode/fuzzy/prefix/minScore`

## 3.6 Bookmark 메타 추출/보안

서버 파일: `server/src/index.js` (`GET /api/bookmark/metadata`)

- URL 정규화: host lower-case, hash 제거, tracking query 제거
- 메타 우선순위:
  - title: `og:title > twitter:title > <title> > domain`
  - excerpt: `og:description > meta description > first paragraph > fallback 문구`
- 제한:
  - timeout(`BOOKMARK_FETCH_TIMEOUT_MS`)
  - 최대 응답 바이트(`BOOKMARK_MAX_RESPONSE_BYTES`)
  - redirect 최대 3회
- SSRF 방어:
  - localhost/loopback/private 대역 차단
- 링크 상태 점검 API는 서버에 유지: `GET /api/bookmark/link-check`

## 4. 프로젝트 구조

```text
src/
  app/
    AppShell.tsx
  core/
    data/
      adapters/remoteDb.ts
      migration.ts
      repository.ts
      schema.ts
      indexer.ts
    navigation/topSection.ts
  features/
    unified-search/
    github/
    youtube/
    bookmark/
  shared/
    components/
    storage/localStorage.ts
  services/translation.ts
server/
  src/index.js
  db/schema.sql
```

## 5. API 요약

### 공통/운영

- `GET /api/health`
- `GET /api/health/deep`
- `GET /api/search`
- `GET /api/admin/export`
- `POST /api/admin/import`

### GitHub 대시보드

- `GET /api/github/dashboard`
- `PUT /api/github/dashboard`

### YouTube

- `GET /api/youtube/videos/:videoId`
- `POST /api/youtube/videos/:videoId/summarize`
- `GET /api/youtube/dashboard`
- `PUT /api/youtube/dashboard`

### Bookmark

- `GET /api/bookmark/metadata?url=...`
- `GET /api/bookmark/link-check?url=...`
- `GET /api/bookmark/dashboard`
- `PUT /api/bookmark/dashboard`

### 레거시 호환/관리

- `PUT /api/providers/:provider/snapshot`
- `GET /api/providers/:provider/items`
- `GET /api/items/:id`

## 6. 빠른 시작

## 6.1 설치

```bash
npm install
npm --prefix server install
```

## 6.2 환경 파일 준비

```bash
cp .env.example .env.local
cp server/.env.example server/.env
```

## 6.3 PostgreSQL 실행

```bash
cd server
docker compose up -d
cd ..
```

## 6.4 마이그레이션

```bash
npm run server:migrate
```

## 6.5 실행

```bash
npm run dev:all
```

기본 주소:

- Front: `http://localhost:5173`
- API: `http://localhost:4000`

## 7. 환경 변수

## 7.1 Client (`.env.local`)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `VITE_GITHUB_TOKEN` | - | GitHub API rate limit 완화 |
| `VITE_GITHUB_TIMEOUT_SECONDS` | `12` | GitHub API 타임아웃 |
| `GLM_API_KEY` | - | 수동 번역(GLM) API 키 |
| `GLM_BASE_URL` | `https://api.z.ai/api/coding/paas/v4` | GLM Base URL |
| `GLM_MODEL` | `glm-4.7` | GLM 모델 |
| `GLM_TIMEOUT_SECONDS` | `30` | GLM 타임아웃 |
| `VITE_OPENAI_API_KEY` | - | 번역 fallback(OpenAI) API 키 |
| `VITE_OPENAI_MODEL` | `gpt-4.1-mini` | OpenAI 모델 |
| `VITE_OPENAI_TIMEOUT_SECONDS` | `30` | OpenAI 타임아웃 |
| `VITE_POSTGRES_SYNC_API_BASE_URL` | `http://localhost:4000` | 서버 API base URL |

## 7.2 Server (`server/.env`)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `4000` | API 포트 |
| `DATABASE_URL` | - | 우선 접속 문자열 |
| `PGHOST` | `localhost` | DB 호스트 |
| `PGPORT` | `55432` | DB 포트 |
| `PGUSER` | `postgres` | DB 유저 |
| `PGPASSWORD` | `postgres` | DB 비밀번호 |
| `PGDATABASE` | `useful_git_info` | DB 이름 |
| `PGSSL` | `false` | SSL 사용 여부 |
| `CORS_ORIGIN` | `http://localhost:5173,http://localhost:5174` | 허용 Origin |
| `YOUTUBE_API_KEY` | - | YouTube Data API 키 |
| `YOUTUBE_API_TIMEOUT_SECONDS` | `12` | YouTube API 타임아웃 |
| `YOUTUBE_SUMMARY_ENABLED` | `true` | YouTube 요약 생성 활성화 |
| `YOUTUBE_SUMMARY_PROVIDER` | `glm` | 요약 엔진 선택(`glm`) |
| `YOUTUBE_SUMMARY_TIMEOUT_SECONDS` | `30` | 요약 생성 타임아웃(초) |
| `NOTEBOOKLM_ENABLED` | `false` | NotebookLM source 동기화 활성화 |
| `NOTEBOOKLM_PROJECT_ID` | - | NotebookLM 프로젝트 ID |
| `NOTEBOOKLM_LOCATION` | `global` | NotebookLM 리전 |
| `NOTEBOOKLM_ENDPOINT_LOCATION` | `global` | NotebookLM API endpoint 위치 (`global/us/eu`) |
| `NOTEBOOKLM_NOTEBOOK_ID` | - | NotebookLM 노트북 ID |
| `NOTEBOOKLM_SERVICE_ACCOUNT_JSON` | - | 서비스 계정 JSON 문자열/파일경로/base64(JSON) |
| `GLM_API_KEY` | - | GLM 요약 API 키 |
| `GLM_BASE_URL` | `https://api.z.ai/api/coding/paas/v4` | GLM Base URL |
| `GLM_MODEL` | `glm-4.7` | GLM 모델 |
| `BOOKMARK_FETCH_TIMEOUT_MS` | `10000` | 북마크 메타 fetch 타임아웃 |
| `BOOKMARK_MAX_RESPONSE_BYTES` | `1048576` | 북마크 HTML 최대 바이트 |

## 8. 스크립트

- `npm run dev`: 프론트 개발 서버
- `npm run server:dev`: 서버 개발 모드
- `npm run dev:all`: 프론트+서버 동시 실행
- `npm run server:migrate`: DB 스키마 반영
- `npm run build`: 타입체크 + 프로덕션 빌드
- `npm run lint`: ESLint
- `npm test`: 단위/통합 테스트
- `npm run test:e2e:postgres`: Postgres E2E 자동 실행
- `npm run restore:dashboard:chrome`: Chrome LocalStorage 복구 스크립트

## 9. 테스트 범위

- 단위 테스트: reducer, 파서, 매핑, storage, search state
- 통합 테스트: App/AppShell 탭 전환, 각 보드 주요 플로우
- 서버/검색 E2E: 북마크 메타 API, provider sync, 검색 랭킹

## 10. 트러블슈팅

- `Failed to fetch` 반복:
  - 서버 실행(`npm run server:dev`)
  - `VITE_POSTGRES_SYNC_API_BASE_URL` 확인
  - `CORS_ORIGIN`에 현재 프론트 주소 포함 확인
- 통합검색 0건:
  - provider/type 필터가 과도하게 좁혀졌는지 확인
  - 데이터가 `unified_items`에 저장되었는지 `/api/providers/:provider/items`로 확인
- YouTube 추가 실패:
  - `YOUTUBE_API_KEY` 설정
  - quota 초과 여부 확인

## 11. 문서

- 제품 요구사항: `docs/PRD.md`
- 기술 설계: `docs/TRD.md`
- 실행 계획/로드맵: `docs/PLAN.md`, `docs/PLAN_EXTENTION1.md`
- 서버 실행 가이드: `server/README.md`
