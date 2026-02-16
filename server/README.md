# useful-git-info PostgreSQL API

## 1) 환경 변수

`server/.env.example`를 복사해 `server/.env`를 생성하세요.

```bash
cp .env.example .env
```

YouTube 카드 기능을 사용하려면 `YOUTUBE_API_KEY`를 설정하세요.

## 2) PostgreSQL 준비

### Docker 사용(권장)

```bash
docker compose up -d
```

기본 연결값:
- host: `localhost`
- port: `55432`
- user: `postgres`
- password: `postgres`
- database: `useful_git_info`

## 3) 실행

```bash
npm install
npm run migrate
npm run start
```

개발 모드:

```bash
npm run dev
```

## 4) 주요 API

- `GET /api/health`
- `GET /api/health/deep`
- `GET /api/github/dashboard`
- `PUT /api/github/dashboard`
- `GET /api/youtube/videos/:videoId`
- `GET /api/youtube/dashboard`
- `PUT /api/youtube/dashboard`
- `PUT /api/providers/:provider/snapshot`
- `GET /api/providers/:provider/items`
- `GET /api/items/:id`
- `GET /api/search?q=...&provider=...&type=...`
- `GET /api/admin/export`
- `POST /api/admin/import`
