# Useful Git Info

<p align="left">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" />
  <img alt="Vite 7" src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" />
  <img alt="Node 20+" src="https://img.shields.io/badge/Node-20+-339933?logo=node.js&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" />
  <img alt="Vitest" src="https://img.shields.io/badge/Tested with Vitest-6E9F18?logo=vitest&logoColor=white" />
</p>

GitHub, YouTube, Bookmark를 카드보드로 관리하고, PostgreSQL 기반 통합검색을 제공하는 웹앱입니다.

## 1. 핵심 요약

- 최상단 메뉴: `통합검색 > 깃허브 > 유튜브 > 북마크`
- 각 메뉴는 `src/features/*` 단위로 분리된 독립 모듈 구조
- 저장소는 PostgreSQL `unified_items / unified_notes / unified_meta`를 기준으로 동작
- 원격 저장 실패 시 복구형 동기화 전략(`healthy/retrying/local/recovered`) 적용
- 통합검색은 PostgreSQL 하이브리드 랭킹(FTS + Prefix + Trigram + 최신성 보정)

## 2. 주요 기능

### 2.1 통합검색

- provider/type 필터 검색 (`github`, `youtube`, `bookmark`)
- 검색 방식 요약 패널 내장
- 최근검색(localStorage) + 결과 캐시(TTL/LRU)
- 백업 내보내기/복원 UI 제공

### 2.2 GitHub 보드

- 입력: `https://github.com/owner/repo` 또는 `owner/repo`
- 카드: repo/owner/요약/언어/stars/forks/링크
- 카테고리: 메인/창고 + 사용자 카테고리, 카드 이동/삭제
- 페이지네이션: 데스크톱 4열, 페이지당 12개
- 상세 모달: `Overview / README / Activity` + 메모 저장
- 요약 재생성: 카드 하단 `요약 재생성` 버튼 (GLM, 수동 트리거)

### 2.3 YouTube 보드

- 입력: `watch`, `youtu.be`, `shorts` 영상 URL
- 카드: 썸네일/제목/채널/조회수/게시일/링크/요약 상태
- 요약: 비동기 큐 기반 GLM 요약 + 재생성 버튼
- NotebookLM 연동 포인트 포함 (`NOTEBOOKLM_ENABLED` 기반)
- 상세 모달 없음 (카드 중심 UX)

### 2.4 Bookmark 보드

- 입력: `http/https` URL
- 서버 메타 추출: title/excerpt/domain/thumbnail/favicon/canonical
- 카드: 제목/요약(또는 excerpt)/링크/추가일/도메인
- 요약 재생성: 비동기 큐 기반 GLM 수동 트리거
- 링크 점검 API, 중복 정리 도우미 포함
- 상세 모달 없음 (카드 중심 UX)

## 3. 아키텍처

## 3.1 프론트 구조

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
```

## 3.2 서버 구조

```text
server/
  src/
    index.js
    services/
      githubSummary*.js
      youtubeSummary*.js
      bookmarkSummary*.js
      notebooklm*.js
  db/schema.sql
```

## 3.3 동기화 원칙

- DB 단일 원본 기반으로 스냅샷 저장
- 네트워크 장애 시 즉시 local-only로 고정하지 않고 재시도 후 전환
- 복구 성공 시 자동 `recovered -> healthy`
- 상단 상태 배지로 현재 연결 상태/마지막 동기화 시간 노출

## 4. 빠른 시작

## 4.1 설치

```bash
npm install
npm --prefix server install
```

## 4.2 환경 파일 준비

```bash
cp .env.example .env.local
cp server/.env.example server/.env
```

## 4.3 PostgreSQL 실행

```bash
cd server
docker compose up -d
cd ..
```

## 4.4 마이그레이션

```bash
npm run server:migrate
```

## 4.5 실행

```bash
npm run dev:all
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000`

`dev:all`은 4000 포트의 기존 서버 프로세스를 먼저 정리한 뒤 최신 서버를 띄웁니다.

## 5. 환경 변수

## 5.1 Client (`.env.local`)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `VITE_POSTGRES_SYNC_API_BASE_URL` | `http://localhost:4000` | 서버 API base URL |
| `VITE_POSTGRES_SYNC_API_TOKEN` | - | 쓰기 보호 API 토큰(선택) |
| `VITE_POSTGRES_SYNC_TIMEOUT_SECONDS` | `12` | 원격 요청 타임아웃 |
| `VITE_GITHUB_TOKEN` | - | GitHub API 제한 완화(선택) |
| `VITE_GITHUB_TIMEOUT_SECONDS` | `12` | GitHub 호출 타임아웃 |
| `GLM_API_KEY` | - | 클라이언트 번역용 GLM 키(선택) |
| `GLM_BASE_URL` | `https://api.z.ai/api/coding/paas/v4` | GLM API URL |
| `GLM_MODEL` | `glm-4.7` | GLM 모델 |
| `GLM_TIMEOUT_SECONDS` | `30` | GLM 호출 타임아웃 |
| `VITE_WEB_VITALS_ENABLED` | `false` | Web Vitals 전송 활성화 |
| `VITE_WEB_VITALS_ENDPOINT` | `http://localhost:4000/api/rum/web-vitals` | RUM 수집 엔드포인트 |

## 5.2 Server (`server/.env`)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `4000` | API 포트 |
| `DATABASE_URL` | - | 우선 접속 문자열 |
| `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` | `localhost/55432/postgres/postgres/useful_git_info` | DB 개별 접속값 |
| `PGSSL` | `false` | SSL 사용 여부 |
| `CORS_ORIGIN` | `http://localhost:5173,http://localhost:5174` | 허용 Origin |
| `ADMIN_API_TOKEN` | - | 대시보드 쓰기 보호 토큰 |
| `YOUTUBE_API_KEY` | - | YouTube Data API 키 |
| `YOUTUBE_SUMMARY_ENABLED` | `true` | YouTube 요약 활성화 |
| `YOUTUBE_SUMMARY_PROVIDER` | `glm` | 요약 제공자 |
| `NOTEBOOKLM_ENABLED` | `false` | NotebookLM source 연동 활성화 |
| `GLM_API_KEY` | - | 서버 요약(GLM) API 키 |
| `GITHUB_SUMMARY_ENABLED` | `true` | GitHub 요약 재생성 활성화 |
| `GITHUB_SUMMARY_README_MAX_BYTES` | `8192` | GitHub README 입력 최대 바이트 |
| `BOOKMARK_FETCH_TIMEOUT_MS` | `10000` | 북마크 메타 추출 타임아웃 |
| `BOOKMARK_MAX_RESPONSE_BYTES` | `1048576` | 메타 추출 최대 응답 바이트 |

세부 변수는 `server/.env.example`를 기준으로 사용하세요.

## 6. API 개요

### 6.1 공통

- `GET /api/health`
- `GET /api/health/deep`
- `GET /api/search`
- `GET /api/admin/export`
- `POST /api/admin/import`

### 6.2 대시보드

- `GET /api/github/dashboard`
- `PUT /api/github/dashboard`
- `GET /api/youtube/dashboard`
- `PUT /api/youtube/dashboard`
- `GET /api/bookmark/dashboard`
- `PUT /api/bookmark/dashboard`

### 6.3 요약 재생성

- GitHub:
  - `POST /api/github/summaries/regenerate`
  - `GET /api/github/summaries/status?repoId=owner/repo`
- YouTube:
  - `POST /api/youtube/videos/:videoId/summarize`
  - `GET /api/youtube/summaries/:videoId/status`
  - `POST /api/youtube/summaries/:jobId/retry`
- Bookmark:
  - `POST /api/bookmark/summaries/regenerate`
  - `GET /api/bookmark/summaries/status?bookmarkId=<normalizedUrl>`

### 6.4 기타

- `GET /api/youtube/videos/:videoId`
- `GET /api/bookmark/metadata?url=...`
- `GET /api/bookmark/link-check?url=...`
- `PUT /api/providers/:provider/snapshot`
- `GET /api/providers/:provider/items`
- `GET /api/items/:id`

## 7. 검색 엔진 상세

`/api/search` 기본 모드 `relevance`는 다음 신호를 결합합니다.

- exact match
- normalized prefix match
- PostgreSQL FTS (`tsvector`, `websearch_to_tsquery`)
- trigram (`similarity`, `word_similarity`) 오탈자 보정
- recency boost

대표 가중치:

```text
score =
  exact*5.0 +
  prefix*2.5 +
  fts*1.8 +
  trgm*1.2 +
  recency*0.4
```

## 8. 테스트/품질 게이트

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e:postgres`

Postgres E2E는 별도 포트(기본 `4100`)와 테스트 DB를 사용해 메인 개발 DB 오염을 방지합니다.

## 9. 트러블슈팅

### 9.1 요약 재생성 404

- 증상: `북마크/깃허브 요약 생성 요청 실패 (404)`
- 점검:
  1. 서버가 최신 코드로 실행 중인지 확인 (`npm run dev:all`)
  2. `VITE_POSTGRES_SYNC_API_BASE_URL`이 현재 서버 주소인지 확인
  3. 대상 카드가 대시보드에 실제 등록되어 있는지 확인

### 9.2 `Failed to fetch`

- 서버 미기동/포트 충돌/네트워크/CORS가 원인일 가능성이 큽니다.
- `npm run dev:status`로 서버/프론트 상태를 먼저 확인하세요.

### 9.3 YouTube 추가 실패

- `YOUTUBE_API_KEY` 누락 또는 quota 초과 여부 확인

### 9.4 원격 읽기 전용 전환

- 원격 DB 연결 장애 시 일부 쓰기 작업이 차단될 수 있습니다.
- 연결 복구 후 자동으로 정상 모드로 전환됩니다.

## 10. 관련 문서

- 제품 요구사항: `docs/PRD.md`
- 기술 설계: `docs/TRD.md`
- 계획 문서: `docs/PLAN.md`, `docs/PLAN_EXTENTION1.md`
- 서버 전용 가이드: `server/README.md`
