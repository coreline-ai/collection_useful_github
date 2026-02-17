# 개인 작업 정보 (Useful Git YouTube Bookmark Info)

<p align="left">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" />
  <img alt="Vite 7" src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" />
  <img alt="Node 20+" src="https://img.shields.io/badge/Node-20+-339933?logo=node.js&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" />
  <img alt="Vitest" src="https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white" />
</p>

업데이트 기준: 2026-02-17

GitHub 저장소, YouTube 영상, 웹 북마크를 카드형으로 저장/분류/검색하는 개인용 대시보드입니다.

## 1. 현재 구현 요약

- 최상단 메뉴: `통합검색 > 깃허브 > 유튜브 > 북마크`
- Feature 분리: `src/features/github`, `src/features/youtube`, `src/features/bookmark`, `src/features/unified-search`
- 저장소: PostgreSQL `unified_items / unified_notes / unified_meta` 기반
- 동기화 상태: `healthy / retrying / local / recovered` + 마지막 성공 시각
- 검색: PostgreSQL 하이브리드 랭킹(FTS + prefix + trigram + recency)
- 요약: GitHub/YouTube/Bookmark 모두 GLM 기반 비동기 큐 + 수동 재생성 버튼

## 2. 보드별 기능

### 2.1 GitHub

- 입력: `owner/repo`, `github.com/owner/repo`, `https://github.com/owner/repo`
- 카드: 이름, 요약, 언어, stars, forks, 링크
- 상세 모달: `Overview / README / Activity` + 메모
- 요약 재생성: 카드 하단 버튼 수동 실행
- 카테고리: 메인/창고 + 사용자 카테고리

### 2.2 YouTube

- 입력: `watch`, `youtu.be`, `shorts` 영상 URL
- 카드: 썸네일, 제목, 채널, 조회수, 게시일, 링크, 요약 상태
- 요약 재생성: 카드 하단 버튼 수동 실행
- NotebookLM 연동 포인트: `NOTEBOOKLM_ENABLED` (기본 비활성)
- 상세 모달 없음

### 2.3 Bookmark

- 입력: `http/https` URL
- 서버 메타 추출: title/excerpt/domain/thumbnail/favicon/canonical
- 카드: 제목, 본문(요약 또는 excerpt), 링크, 추가일, 도메인
- 요약 재생성: 카드 하단 버튼 수동 실행
- 링크 상태 점검 API 제공 (`/api/bookmark/link-check`)
- 상세 모달 없음

### 2.4 통합검색

- provider/type 필터
- 최근검색(localStorage)
- 결과 캐시(TTL/LRU)
- 백업 내보내기/복원

## 3. 빠른 시작

### 3.1 설치

```bash
npm install
npm --prefix server install
```

### 3.2 환경 파일

```bash
cp .env.example .env.local
cp server/.env.example server/.env
```

### 3.3 PostgreSQL 실행

```bash
cd server
docker compose up -d
cd ..
```

### 3.4 마이그레이션 + 실행

```bash
npm run server:migrate
npm run dev:all
```

- Web: `http://localhost:5173`
- API: `http://localhost:4000`

## 4. 주요 npm 스크립트

- 개발/기동
  - `npm run dev:all`
  - `npm run dev:status`
  - `npm run server:migrate`
- 품질/테스트
  - `npm run lint`
  - `npm run test`
  - `npm run build`
  - `npm run test:e2e:postgres`
- 보안/운영
  - `npm run scan:secrets`
  - `npm run scan:secrets:history`
  - `npm run audit:deps`
  - `npm run db:backup`
  - `npm run db:restore -- --input <backup.sql.gz>`
  - `npm run db:verify`
  - `npm run db:drill`
  - `npm run perf:check-web-vitals`
  - `npm run qa:browser-mobile`

## 5. 운영 점검 루틴(권장)

| 항목 | 명령어 | 주기 |
|---|---|---|
| Tracked 파일 시크릿 점검 | `npm run scan:secrets` | 매 PR |
| Git 히스토리 시크릿 점검 | `npm run scan:secrets:history` | 주 1회 |
| DB 백업/복구 리허설 | `npm run db:drill` | 주 1회 |
| Web Vitals 임계치 점검 | `npm run perf:check-web-vitals` | 주 1회 + 배포 직후 |
| 브라우저/모바일 QA | `npm run qa:browser-mobile` | 주 1회 |

## 6. API 개요

### 6.1 상태/검색/운영

- `GET /api/health`
- `GET /api/health/deep`
- `GET /api/search`
- `POST /api/rum/web-vitals`
- `GET /api/admin/rum/web-vitals/summary`
- `DELETE /api/admin/rum/web-vitals/samples`
- `GET /api/admin/export`
- `POST /api/admin/import`

### 6.2 대시보드

- `GET /api/github/dashboard`
- `PUT /api/github/dashboard`
- `GET /api/github/dashboard/history`
- `POST /api/github/dashboard/rollback`
- `GET /api/youtube/dashboard`
- `PUT /api/youtube/dashboard`
- `GET /api/bookmark/dashboard`
- `PUT /api/bookmark/dashboard`

### 6.3 요약/메타

- GitHub
  - `POST /api/github/summaries/regenerate`
  - `GET /api/github/summaries/status?repoId=owner/repo`
- YouTube
  - `GET /api/youtube/videos/:videoId`
  - `POST /api/youtube/videos/:videoId/summarize`
  - `GET /api/youtube/summaries/:videoId/status`
  - `POST /api/youtube/summaries/:jobId/retry`
- Bookmark
  - `GET /api/bookmark/metadata?url=...`
  - `GET /api/bookmark/link-check?url=...`
  - `POST /api/bookmark/summaries/regenerate`
  - `GET /api/bookmark/summaries/status?bookmarkId=<normalizedUrl>`

### 6.4 유틸

- `PUT /api/providers/:provider/snapshot`
- `GET /api/providers/:provider/items`
- `GET /api/items/:id`

## 7. 문서

- 제품 요구사항: `docs/PRD.md`
- 기술 설계: `docs/TRD.md`
- 실행 계획: `docs/PLAN.md`, `docs/PLAN_EXTENTION1.md`
- 운영 체크리스트: `docs/WEBAPP_ESSENTIAL_CHECKLIST_PLAN.md`
- 백업/복구: `docs/DB_BACKUP_RESTORE_RUNBOOK.md`
- 릴리즈/롤백: `docs/RELEASE_ROLLBACK_RUNBOOK.md`
- 브랜치 보호: `docs/BRANCH_PROTECTION_SETUP.md`
- 성능 예산: `docs/PERF_BUDGETS.md`
- 보안 키 회전: `docs/SECURITY_KEY_ROTATION_RUNBOOK.md`
- QA 체크/로그: `docs/QA_BROWSER_MOBILE_CHECKLIST.md`, `docs/QA_BROWSER_MOBILE_LOG.md`
- Mac mini launchd 운영: `docs/MAC_MINI_SLEEP_RESUME_DEPLOYMENT.md`

## 8. 참고

- 브라우저 탭 제목/아이콘은 `index.html`, `public/personal-work-info-icon.svg` 기준
- 프로덕션에서는 `ADMIN_API_TOKEN` 설정을 권장합니다.
