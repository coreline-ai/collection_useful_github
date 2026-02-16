# Useful Git Info

<p align="left">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" />
  <img alt="Vite 7" src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql&logoColor=white" />
  <img alt="Vitest" src="https://img.shields.io/badge/Tested_with-Vitest-6E9F18?logo=vitest&logoColor=white" />
</p>

GitHub 저장소를 카드보드로 수집/분류하고, 통합검색으로 `github / youtube / bookmark` 데이터를 하나의 스키마로 조회하는 React + PostgreSQL 프로젝트입니다.

## 목차

- [핵심 기능](#핵심-기능)
- [아키텍처](#아키텍처)
- [통합검색 방식](#통합검색-방식)
- [빠른 시작](#빠른-시작)
- [환경 변수](#환경-변수)
- [데이터 모델](#데이터-모델)
- [프로젝트 구조](#프로젝트-구조)
- [API 요약](#api-요약)
- [스크립트](#스크립트)
- [테스트](#테스트)
- [트러블슈팅](#트러블슈팅)
- [문서](#문서)

## 핵심 기능

### 1) 글로벌 탭
- 최상단 탭 순서: `통합검색 > 깃허브 > 유튜브 > 북마크`
- 마지막 선택 탭은 `top_section_v1`로 복원
- `통합검색`은 탭 전용 화면으로 독립 분리

### 2) GitHub 보드
- URL 입력으로 카드 생성 (`owner/repo`, `github.com/owner/repo`, `https://github.com/owner/repo`)
- 데스크톱 4열, 페이지당 12개, 페이지네이션 지원
- 기본 카테고리: `메인(main)`, `창고(warehouse)` 자동 생성
- 사용자 카테고리 생성/이름변경/삭제, 카드 이동(단일 소속)
- 메인 카테고리에서만 신규 저장소 추가 가능

### 3) 상세 모달
- 탭: `개요 / README / Activity`
- README는 sanitize된 Markdown 렌더링(heading anchor/table/task-list 스타일)
- Activity는 저장소 이벤트 기반 타임라인
- 메모 입력 후 즉시 누적, 영속 저장

### 4) 수동 번역
- 자동 번역 없음
- 개요/README/Activity 각각 수동 번역 버튼 제공
- GLM 우선, OpenAI fallback

### 5) 통합검색 + 백업
- Provider/Type 필터 포함 전역 검색
- 검색 결과 스코어/매칭 신호(`exact/prefix/fts/trgm`) 지원
- 백업 내보내기(JSON) / 백업 복원(JSON)

### 6) 테마
- `light | dark` 토글
- 저장값 없을 때 OS 다크모드 1회 감지
- 다크 테마는 순수 블랙 기반 팔레트

## 아키텍처

### Feature Isolation
- `src/features/github`
- `src/features/unified-search`
- `src/features/youtube`
- `src/features/bookmark`

각 feature는 독립 엔트리로 동작하고, 공통 계층(`src/core`, `src/shared`)만 참조합니다.

### Shell Composition
- `AppShell`은 탭 라우팅/테마/초기 마이그레이션만 담당
- 비즈니스 로직은 각 feature 내부에서 처리

### Data Layer
- PostgreSQL 단일 스키마(`unified_items`, `unified_notes`, `unified_meta`)
- 로컬 마이그레이션으로 기존 데이터를 unified 스키마로 이관
- GitHub 보드는 원격 실패 시 로컬 저장소로 degrade

## 통합검색 방식

서버 `/api/search` 기본 모드는 `mode=relevance`이며, 다음 신호를 결합합니다.

- `exact`: title/native id 정확 일치
- `prefix`: title 접두사 일치
- `fts`: `tsvector + websearch_to_tsquery` 기반 의미 검색
- `trgm`: `pg_trgm similarity + word_similarity` 오탈자 보정
- `recency`: 최근 업데이트 가점

### 용어를 풀어쓴 동작 설명

1. 검색어 정규화
- 서버는 검색어를 `lower + unaccent` 처리해 대소문자/악센트 영향을 줄입니다.

2. FTS(Full-Text Search, 전문 검색)
- `tsvector`는 제목/요약/설명을 검색용 토큰으로 미리 만든 벡터입니다.
- `websearch_to_tsquery`는 사용자가 입력한 검색어를 질의 객체(`tsquery`)로 변환합니다.
- 제목(A), 요약(B), 설명(C) 가중치를 다르게 부여해 제목 일치를 더 높게 평가합니다.

3. Prefix(접두사) 매칭
- `title LIKE '검색어%'` 조건으로 “앞글자부터 맞는” 결과를 가점 처리합니다.
- 예: `rea` 입력 시 `react` 계열이 빠르게 상단 노출됩니다.

4. Trigram(3글자 조각) 오탈자 보정
- 문자열을 3글자 단위 조각으로 비교해 유사도를 계산합니다.
- `similarity + word_similarity`를 함께 사용해 `raect` 같은 철자 오차도 탐지합니다.
- 현재 구현은 검색어 길이에 따라 임계치를 다르게 적용합니다.
  - 길이 4자 이상: 0.10 이상
  - 길이 2~3자: 0.16 이상
  - 길이 1자: trigram 실질 비활성(노이즈 방지)

5. 최신성 보정(Recency Boost)
- `updated_at`이 최근일수록 추가 점수를 부여합니다.
- 같은 관련도라면 최신 데이터가 먼저 나오도록 보정합니다.

랭킹 수식(요약):

```text
score =
  exact*5.0 +
  prefix*2.5 +
  fts_rank*1.8 +
  trgm_similarity*1.2 +
  recency_boost*0.4
```

정렬은 `score DESC, updated_at DESC`입니다.

### 클라이언트 검색 캐시
- 메모리 TTL/LRU 결과 캐시:
  - TTL(Time To Live): 60초
  - LRU(Least Recently Used): 최대 50개를 넘으면 가장 오래 안 쓴 캐시부터 제거
- 최근검색(localStorage): `unified_recent_queries_v1`에 최대 20개 저장
- 캐시 키 구성: `query/provider/type/limit/mode/fuzzy/prefix/minScore` 조합

## 빠른 시작

### 1) 설치

```bash
npm install
npm --prefix server install
```

### 2) 환경 파일 준비

```bash
cp .env.example .env.local
cp server/.env.example server/.env
```

### 3) PostgreSQL 실행

```bash
cd server
docker-compose up -d
cd ..
```

### 4) 스키마 반영 + 서버 실행

```bash
npm run server:migrate
npm run server:start
```

### 5) 프론트 실행

```bash
npm run dev
```

실행 주소:
- Frontend: `http://localhost:5173`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/api/health`

## 환경 변수

### Client (`.env.local`)

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `VITE_GITHUB_TOKEN` | 선택 | - | GitHub API rate-limit 완화 |
| `VITE_GITHUB_TIMEOUT_SECONDS` | 선택 | `12` | GitHub API 타임아웃(초) |
| `GLM_API_KEY` | 선택 | - | GLM 번역 API 키 |
| `GLM_BASE_URL` | 선택 | `https://api.z.ai/api/coding/paas/v4` | GLM API Base URL |
| `GLM_MODEL` | 선택 | `glm-4.7` | GLM 모델 |
| `GLM_TIMEOUT_SECONDS` | 선택 | `30` | GLM 타임아웃(초) |
| `VITE_OPENAI_API_KEY` | 선택 | - | OpenAI 번역 fallback 키 |
| `VITE_OPENAI_MODEL` | 선택 | `gpt-4.1-mini` | OpenAI fallback 모델 |
| `VITE_OPENAI_TIMEOUT_SECONDS` | 선택 | `30` | OpenAI 타임아웃(초) |
| `VITE_POSTGRES_SYNC_API_BASE_URL` | 선택 | `http://localhost:4000` | 원격 PostgreSQL API |

### Server (`server/.env`)

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `PORT` | 선택 | `4000` | API 포트 |
| `DATABASE_URL` | 선택 | - | 우선 접속 문자열 |
| `PGHOST` | 선택 | `localhost` | DB 호스트 |
| `PGPORT` | 선택 | `55432` | DB 포트 |
| `PGUSER` | 선택 | `postgres` | DB 유저 |
| `PGPASSWORD` | 선택 | `postgres` | DB 비밀번호 |
| `PGDATABASE` | 선택 | `useful_git_info` | DB 이름 |
| `PGSSL` | 선택 | `false` | SSL 사용 여부 |
| `CORS_ORIGIN` | 선택 | `http://localhost:5173` | CORS 허용 출처 |

## 데이터 모델

핵심 타입은 `src/types.ts`를 기준으로 합니다.

```ts
type ProviderType = 'github' | 'youtube' | 'bookmark'
type UnifiedItemType = 'repository' | 'video' | 'bookmark'

type UnifiedItem = {
  id: string // `${provider}:${nativeId}`
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

주요 localStorage 키:
- `top_section_v1`
- `github_theme_mode_v1`
- `unified_recent_queries_v1`
- `github_cards_v1` (fallback/legacy)
- `github_notes_v1` (fallback/legacy)
- `github_repo_detail_cache_v1`

## 프로젝트 구조

```text
.
├─ docs/
│  ├─ PRD.md
│  ├─ TRD.md
│  ├─ PLAN.md
│  └─ PLAN_EXTENTION1.md
├─ server/
│  ├─ db/schema.sql
│  └─ src/index.js
├─ scripts/
│  ├─ run-postgres-e2e.sh
│  └─ restore-dashboard-from-chrome-localstorage.mjs
└─ src/
   ├─ app/
   │  └─ AppShell.tsx
   ├─ core/
   │  ├─ data/
   │  │  ├─ adapters/
   │  │  ├─ indexer.ts
   │  │  ├─ migration.ts
   │  │  ├─ repository.ts
   │  │  └─ schema.ts
   │  └─ navigation/topSection.ts
   ├─ features/
   │  ├─ github/
   │  ├─ unified-search/
   │  ├─ youtube/
   │  └─ bookmark/
   ├─ shared/
   │  ├─ components/
   │  ├─ storage/
   │  └─ types.ts
   ├─ services/
   ├─ storage/
   └─ utils/
```

## API 요약

주요 엔드포인트:
- `GET /api/health`
- `GET /api/health/deep`
- `GET /api/github/dashboard`
- `PUT /api/github/dashboard`
- `PUT /api/providers/:provider/snapshot`
- `GET /api/providers/:provider/items`
- `GET /api/items/:id`
- `GET /api/search`
- `GET /api/admin/export`
- `POST /api/admin/import`

## 스크립트

```bash
npm run dev                  # frontend dev (5173)
npm run server:dev           # backend watch
npm run server:start         # backend start
npm run server:migrate       # schema apply
npm run build                # typecheck + build
npm run preview              # preview build
npm run lint                 # lint
npm run test                 # unit/integration
npm run test:e2e:postgres    # postgres e2e
npm run test:watch           # watch mode
npm run test:coverage        # coverage
npm run restore:dashboard:chrome
```

## 테스트

기본 실행:

```bash
npm run test
```

PostgreSQL E2E:

```bash
npm run test:e2e:postgres
```

`test:e2e:postgres`는 전용 DB/포트(`4100` 기본)를 사용해 메인 데이터 오염을 방지합니다.

## 트러블슈팅

### 1) `대시보드 저장에 실패했습니다`
- `VITE_POSTGRES_SYNC_API_BASE_URL` 확인
- `server` 실행 및 `/api/health` 정상 응답 확인
- 실패 시 GitHub feature는 로컬 저장으로 degrade됩니다.

### 2) 통합검색 결과가 없거나 느림
- 서버 `/api/search` 응답 확인
- DB 확장(`pg_trgm`, `unaccent`) 및 인덱스 적용 확인
- 동일 검색 반복 시 60초 캐시 동작 여부 확인

### 3) GitHub API 제한(403)
- `VITE_GITHUB_TOKEN` 설정
- 상세 캐시 사용/업데이트 빈도 점검

### 4) 번역 미동작
- `GLM_API_KEY` 또는 `VITE_OPENAI_API_KEY` 설정 확인
- 타임아웃/모델 변수 확인

## 문서

- 제품 요구사항: `docs/PRD.md`
- 기술 설계: `docs/TRD.md`
- 구현 계획: `docs/PLAN.md`
- 확장 계획: `docs/PLAN_EXTENTION1.md`
