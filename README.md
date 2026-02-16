# GitHub Card Dashboard

<p align="left">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" />
  <img alt="Vitest" src="https://img.shields.io/badge/Tested_with-Vitest-6E9F18?logo=vitest&logoColor=white" />
</p>

GitHub 저장소 URL을 입력하면 카드형 보드로 수집/분류하고, 상세 팝업에서 `개요 / README / Activity / 메모`를 확인하는 웹앱입니다.  
카테고리(메인/창고/사용자 카테고리), 상세 캐시, 수동 번역, 라이트/다크(순수 블랙) 테마를 제공합니다.

## Table of Contents

- [핵심 기능](#핵심-기능)
- [기술 스택](#기술-스택)
- [빠른 시작](#빠른-시작)
- [환경 변수](#환경-변수)
- [동작 규칙](#동작-규칙)
- [테마 시스템](#테마-시스템)
- [캐시 전략](#캐시-전략)
- [번역 전략](#번역-전략)
- [저장소 구조](#저장소-구조)
- [데이터 모델](#데이터-모델)
- [스크립트](#스크립트)
- [테스트](#테스트)
- [트러블슈팅](#트러블슈팅)
- [문서](#문서)

## 핵심 기능

### 1) 저장소 등록
- 입력 형식 지원:
  - `owner/repo`
  - `https://github.com/owner/repo`
  - `github.com/owner/repo`
- 중복 등록 차단
- 유효하지 않은 URL/접근 불가/요청 제한 등 에러 메시지 분기 처리

### 2) 카드 보드
- 데스크톱 4열 그리드
- 페이지당 12개 노출 + 숫자 페이지네이션 + 이전/다음
- 카드 표시 항목:
  - 저장소명, owner
  - Summary(3줄 clamp)
  - 언어, 업데이트일
  - Stars, Forks
  - GitHub 링크, 상세 보기

### 3) 카테고리 시스템
- 기본 카테고리 자동 생성:
  - `메인(main)` / `창고(warehouse)`
- 사용자 카테고리 생성/이름변경/삭제 지원
- 카드는 단일 카테고리 소속(복사 아님, 이동)
- 카드 헤더의 이동 드롭다운으로 카테고리 이동
- 카테고리 삭제 시 소속 카드는 자동으로 `창고` 이동
- 저장소 추가는 `메인`에서만 가능

### 4) 상세 팝업
- 탭:
  - `개요(Overview)`
  - `README`
  - `Activity`
- 개요:
  - Stars/Forks/Watchers/Open issues 등 메타 정보
- README:
  - sanitize된 Markdown 렌더링
  - heading anchor, table, task list 스타일 반영
- Activity:
  - commit / issue / pull request 통합 타임라인
- 메모:
  - 최대 500자
  - 입력 즉시 하단 누적
  - localStorage 영속화

### 5) 수동 번역 (자동 번역 없음)
- 번역 버튼은 상세 탭별 수동 실행
  - 개요 번역
  - README 번역
  - Activity 번역
- 번역/원문 토글 제공

### 6) 테마
- 라이트/다크 전환 토글(상단 우측)
- 다크는 순수 블랙 기반 팔레트
- 저장값이 없을 때 OS `prefers-color-scheme`를 1회 반영
- 이후 사용자 선택값 localStorage 우선

### 7) 통합 검색/백업
- 상단 통합 검색(Provider/Type 필터)
- PostgreSQL 기반 전역 검색 API 연동
- 백업 내보내기(JSON) / 백업 복원(JSON)

## 기술 스택

- Frontend: React 19 + TypeScript + Vite
- Backend: Node.js + Express
- DB: PostgreSQL 15+
- Markdown: `marked` + `dompurify`
- 상태 관리: `useReducer` + hooks
- 저장소: PostgreSQL 단일 소스(권장) + localStorage fallback
- 테스트: Vitest + Testing Library

## 빠른 시작

### 요구사항
- Node.js 20+ 권장
- npm 10+ 권장

### 설치/실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속
(`5173` 고정, 사용 중이면 `npm run dev`가 실패하도록 설정됨)

### PostgreSQL 서버 실행(옵션)

```bash
cp server/.env.example server/.env
npm --prefix server install
npm run server:start
```

- 기본 API 주소: `http://localhost:4000`
- 클라이언트에서 PostgreSQL 동기화를 쓰려면 `.env.local`에 `VITE_POSTGRES_SYNC_API_BASE_URL=http://localhost:4000` 추가

PostgreSQL을 로컬 Docker로 띄우려면:

```bash
cd server
docker-compose up -d
```

실행 주소:
- 프론트엔드: `http://localhost:5173`
- PostgreSQL API: `http://localhost:4000`
- 헬스체크: `http://localhost:4000/api/health`

### 프로덕션 빌드

```bash
npm run build
npm run preview
```

## 환경 변수

`.env.example`를 복사해 `.env.local`로 사용하면 됩니다.

```bash
cp .env.example .env.local
```

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `VITE_GITHUB_TOKEN` | 선택 | - | GitHub API rate limit 완화 |
| `VITE_GITHUB_TIMEOUT_SECONDS` | 선택 | `12` | GitHub API 타임아웃(초) |
| `GLM_API_KEY` | 선택 | - | GLM 번역 API 키 |
| `GLM_BASE_URL` | 선택 | `https://api.z.ai/api/coding/paas/v4` | GLM API Base URL |
| `GLM_MODEL` | 선택 | `glm-4.7` | GLM 모델명 |
| `GLM_TIMEOUT_SECONDS` | 선택 | `30` | GLM 번역 타임아웃(초) |
| `VITE_OPENAI_API_KEY` | 선택 | - | OpenAI 번역 fallback 키 |
| `VITE_OPENAI_MODEL` | 선택 | `gpt-4.1-mini` | OpenAI fallback 모델 |
| `VITE_OPENAI_TIMEOUT_SECONDS` | 선택 | `30` | OpenAI fallback 타임아웃(초) |
| `VITE_POSTGRES_SYNC_API_BASE_URL` | 선택 | - | PostgreSQL 동기화 API Base URL |

번역 제공자 우선순위:
1. `GLM_*`가 있으면 GLM 사용
2. 없으면 `VITE_OPENAI_*` 사용
3. 둘 다 없으면 원문 유지

`vite.config.ts`에서 `envPrefix: ['VITE_', 'GLM_']`를 사용하므로 `GLM_*`도 클라이언트에서 읽습니다.

## 동작 규칙

### 저장소 추가
- `메인` 카테고리에서만 입력 폼 노출
- 다른 카테고리는 안내 문구 표시

### 카드 이동/삭제
- 카드 이동 시 대상 카테고리 목록의 맨 위에 배치
- 카드 삭제 시 연결된 메모 + 상세 캐시 함께 제거

### 카테고리 관리
- 기본 카테고리(`메인`, `창고`) 삭제 불가
- 이름변경은 가능
- 관리 탭에서 검색/정렬/시스템 카테고리 토글 지원

## 테마 시스템

- 모드: `light | dark`
- localStorage 키: `github_theme_mode_v1`
- 초기 결정 로직:
  1. 저장된 테마가 있으면 사용
  2. 없으면 OS 다크모드 감지(`matchMedia`)
- DOM 반영:
  - `document.documentElement.dataset.theme = 'light' | 'dark'`
- 스타일 전략:
  - `src/index.css`에서 의미 기반 CSS 변수 정의
  - `src/App.css`는 토큰 참조 중심으로 구성

## 캐시 전략

상세 팝업(README/Activity)은 캐시 우선 로딩으로 GitHub API 호출을 줄입니다.

- 키: `github_repo_detail_cache_v1`
- TTL: 24시간 (`DETAIL_CACHE_TTL_HOURS`)
- 흐름:
  1. 모달 열기
  2. 캐시 hit -> 즉시 렌더
  3. 캐시 miss -> 원격 호출 후 저장

업데이트 확인:
1. `업데이트 확인` 클릭
2. 최신 커밋 SHA 비교
3. 변경 감지 시 `최신 데이터 불러오기` 노출

## 번역 전략

- 자동 번역 없음
- 탭별 수동 버튼 클릭 시만 호출
- 실패 시 원문 유지(UX 끊김 방지)
- Markdown 번역 시 구조(링크/테이블/코드블록) 보존 지시

## 저장소 구조

```text
.
├─ docs/
│  ├─ PRD.md
│  ├─ TRD.md
│  ├─ PLAN.md
│  └─ PLAN_EXTENTION1.md
├─ src/
│  ├─ components/
│  │  ├─ RepoCard.tsx
│  │  ├─ RepoDetailModal.tsx
│  │  ├─ RepoInputForm.tsx
│  │  ├─ Pagination.tsx
│  │  └─ CategorySettingsModal.tsx
│  ├─ services/
│  │  ├─ github.ts
│  │  └─ translation.ts
│  ├─ state/
│  │  └─ dashboardReducer.ts
│  ├─ storage/
│  │  ├─ localStorage.ts
│  │  └─ detailCache.ts
│  ├─ utils/
│  │  ├─ parseGitHubRepoUrl.ts
│  │  ├─ summary.ts
│  │  ├─ markdown.ts
│  │  ├─ paginate.ts
│  │  └─ theme.ts
│  ├─ App.tsx
│  ├─ App.css
│  ├─ index.css
│  ├─ constants.ts
│  └─ types.ts
└─ README.md
```

## 데이터 모델

핵심 타입은 `src/types.ts` 참고.

```ts
type ThemeMode = 'light' | 'dark'

type Category = {
  id: 'main' | 'warehouse' | string
  name: string
  isSystem: boolean
  createdAt: string
}

type GitHubRepoCard = {
  id: string
  categoryId: string
  owner: string
  repo: string
  fullName: string
  description: string
  summary: string
  htmlUrl: string
  homepage: string | null
  language: string | null
  stars: number
  forks: number
  watchers: number
  openIssues: number
  topics: string[]
  license: string | null
  defaultBranch: string
  createdAt: string
  updatedAt: string
  addedAt: string
}
```

localStorage 키:
- `github_cards_v1`
- `github_notes_v1`
- `github_repo_detail_cache_v1`
- `github_categories_v1`
- `github_selected_category_v1`
- `github_theme_mode_v1`
- `top_section_v1`
- `unified_items_v1`
- `unified_indexes_v1`
- `unified_meta_v1`
- `unified_notes_v1`

## 스크립트

```bash
npm run dev            # 개발 서버
npm run server:dev     # PostgreSQL API 서버(watch)
npm run server:start   # PostgreSQL API 서버(start)
npm run server:migrate # DB 스키마 수동 반영
npm run build          # 타입체크 + 프로덕션 빌드
npm run preview        # 빌드 결과 미리보기
npm run lint           # ESLint
npm run test           # Vitest 일회 실행
npm run test:e2e:postgres # PostgreSQL E2E(스냅샷/라운드트립)
npm run test:watch     # Vitest watch
npm run test:coverage  # 커버리지 포함 테스트
```

`test:e2e:postgres`는 전용 API 서버를 `http://localhost:4100`(기본)으로 자동 기동해 실행합니다.

## 테스트

현재 주요 테스트 범위:
- URL 파서
- 페이지네이션
- 리듀서(카테고리/이동/삭제)
- Markdown 렌더 sanitize
- 번역 서비스 fallback
- 테마 유틸/스토리지
- App 통합 시나리오(등록/중복/이동/상세/메모/테마)
- PostgreSQL E2E(저장/재로딩 라운드트립)

```bash
npm run test
```

## 트러블슈팅

### 1) GitHub API 요청 제한(403)
- `VITE_GITHUB_TOKEN` 설정
- 필요 시 상세 캐시를 활용해 동일 리포 재조회 최소화

### 2) README/Activity가 비어 보일 때
- 저장소가 비어 있거나 API 응답이 제한될 수 있음
- 상세 팝업에서 `업데이트 확인` → 필요 시 `최신 데이터 불러오기`

### 3) 번역이 동작하지 않을 때
- `GLM_API_KEY` 또는 `VITE_OPENAI_API_KEY` 설정 확인
- 모델/타임아웃 변수 값 확인

### 4) 캐시 초기화
- 브라우저 localStorage에서 아래 키 삭제:
  - `github_repo_detail_cache_v1`
  - 필요 시 `github_cards_v1`, `github_notes_v1`

## 문서

- 제품 요구사항: `docs/PRD.md`
- 기술 설계: `docs/TRD.md`
- 구현/확장 계획: `docs/PLAN.md`, `docs/PLAN_EXTENTION1.md`
