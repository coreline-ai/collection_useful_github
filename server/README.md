# useful-git-info Server (PostgreSQL API)

## 1. 개요

이 서버는 GitHub/YouTube/Bookmark 보드 데이터를 PostgreSQL에 저장하고, 통합검색/백업/메타 추출 API를 제공합니다.

핵심 파일:

- API 서버: `server/src/index.js`
- DB 스키마: `server/db/schema.sql`
- 마이그레이션: `server/src/migrate.js`

## 2. 환경 변수

`server/.env.example`를 복사해 `server/.env` 생성:

```bash
cp .env.example .env
```

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
| `CORS_ORIGIN` | `http://localhost:5173,http://localhost:5174` | 허용 Origin(콤마 구분) |
| `YOUTUBE_API_KEY` | - | YouTube Data API v3 키 |
| `YOUTUBE_API_TIMEOUT_SECONDS` | `12` | YouTube API 타임아웃 |
| `BOOKMARK_FETCH_TIMEOUT_MS` | `10000` | 북마크 메타 추출 timeout(ms) |
| `BOOKMARK_MAX_RESPONSE_BYTES` | `1048576` | 북마크 HTML 최대 읽기 바이트 |

## 3. 실행

```bash
npm install
npm run migrate
npm run dev
```

프로덕션 실행:

```bash
npm run start
```

## 4. PostgreSQL 준비

Docker Compose 사용:

```bash
docker compose up -d
```

기본 연결 정보:

- host: `localhost`
- port: `55432`
- user: `postgres`
- password: `postgres`
- database: `useful_git_info`

## 5. API 목록

## 5.1 Health

- `GET /api/health`
- `GET /api/health/deep`

## 5.2 Dashboard

- `GET /api/github/dashboard`
- `PUT /api/github/dashboard`
- `GET /api/youtube/dashboard`
- `PUT /api/youtube/dashboard`
- `GET /api/bookmark/dashboard`
- `PUT /api/bookmark/dashboard`

## 5.3 Provider/Items (레거시/관리)

- `PUT /api/providers/:provider/snapshot`
- `GET /api/providers/:provider/items`
- `GET /api/items/:id`

## 5.4 Search / Backup

- `GET /api/search?q=...&provider=...&type=...&mode=...&fuzzy=...&prefix=...&min_score=...`
- `GET /api/admin/export`
- `POST /api/admin/import`

## 5.5 YouTube

- `GET /api/youtube/videos/:videoId`

## 5.6 Bookmark

- `GET /api/bookmark/metadata?url=...`
- `GET /api/bookmark/link-check?url=...`

## 6. 검색 엔진 요약

`/api/search` 기본 모드 `relevance`는 다음을 결합합니다.

- exact match
- prefix match
- PostgreSQL FTS (`tsvector`, `websearch_to_tsquery`)
- trigram similarity (`similarity`, `word_similarity`)
- recency boost

또한 `/api/search`는 IP 기준 rate limit(`60 req/min`)를 적용합니다.

## 7. Bookmark 메타 추출/보안 정책

- URL 검증(`http/https`)
- credentials 포함 URL 거부
- private/local 네트워크 접근 차단(SSRF 방지)
- redirect 최대 3회
- timeout 및 최대 바이트 제한
- HTML이 아니면 fallback 메타 반환

## 8. 스키마/인덱스

`server/db/schema.sql` 핵심:

- extension: `pg_trgm`, `unaccent`
- table: `unified_items`, `unified_notes`, `unified_meta`
- GIN 인덱스:
  - trigram(lower title/summary/description/author/native_id)
  - weighted search vector(title/native_id/summary/author/description/tags)

## 9. 운영 체크리스트

- CORS 오류 발생 시 `CORS_ORIGIN` 확인
- YouTube 추가 실패 시 `YOUTUBE_API_KEY` 및 quota 확인
- 검색 성능 저하 시 인덱스/쿼리 플랜 점검
- 마이그레이션 누락 시 `npm run migrate` 재실행
