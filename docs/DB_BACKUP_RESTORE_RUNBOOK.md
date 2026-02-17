# DB Backup / Restore Runbook

업데이트 기준: 2026-02-17

## 목표

- RPO: 최대 24시간
- RTO: 30분 이내

## 사전 조건

- PostgreSQL 접근 가능 환경
- `server/.env` 또는 DB 접속 환경 변수 설정
- `pg_dump`, `psql`, `gzip`, `gunzip` 설치

## 1) 백업

```bash
npm run db:backup
```

명시 경로:

```bash
npm run db:backup -- --output backups/manual_20260217.sql.gz
```

## 2) 복구

```bash
npm run db:restore -- --input backups/manual_20260217.sql.gz
```

복구 후 검증:

```bash
npm run db:verify
```

## 3) 자동 리허설 (권장)

```bash
npm run db:drill
```

동작:

1. 현재 DB 백업 생성
2. 리허설 DB 생성
3. 확장(unaccent/pg_trgm) 준비
4. 백업 복구
5. provider/meta/note 집계 비교
6. `.runtime/drill/*.md` 리포트 출력

## 4) 복구 검증 SQL

```sql
SELECT provider, COUNT(*) FROM unified_items GROUP BY provider ORDER BY provider;
SELECT key FROM unified_meta ORDER BY key;
SELECT provider, COUNT(*) FROM unified_notes GROUP BY provider ORDER BY provider;
```

## 5) 장애 대응 순서

1. API 쓰기 중지(배포 중단/운영 공지)
2. 최신 백업 선택
3. 복구 실행
4. 검증 실행(`db:verify` + 앱 smoke test)
5. 정상 확인 후 쓰기 재개

## 6) 주기 정책

- 일 1회 자동 백업(권장)
- 주요 배포 전 수동 백업 1회
- 주 1회 복구 리허설

## 7) 리허설 실행 기록

| 회차 | 일시(UTC) | 백업 파일 | 리허설 DB | 결과 | RTO(s) | RPO | 리포트 |
|---|---|---|---|---|---:|---|---|
| 1 | 2026-02-17T14:19:22Z | `backups/drill_20260217T141922Z.sql.gz` | `useful_git_info_drill_20260217t141922z_75830` | PASS | 0 | near-zero | `.runtime/drill/drill_20260217T141922Z.md` |
| 2 | 2026-02-17T14:38:08Z | `backups/drill_20260217T143808Z.sql.gz` | `useful_git_info_drill_20260217t143808z_86680` | PASS | 0 | near-zero | `.runtime/drill/drill_20260217T143808Z.md` |
