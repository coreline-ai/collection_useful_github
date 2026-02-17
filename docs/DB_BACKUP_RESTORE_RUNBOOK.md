# DB Backup / Restore Runbook

업데이트 기준: 2026-02-17

## 목표

- RPO: 최대 24시간
- RTO: 30분 이내

## 사전 조건

- PostgreSQL 접근 가능한 환경
- `server/.env` 또는 DB 접속 환경 변수 설정
- `pg_dump`, `psql`, `gzip` 설치

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

## 3) 복구 검증 SQL (추가 확인)

```sql
SELECT provider, COUNT(*) FROM unified_items GROUP BY provider ORDER BY provider;
SELECT key FROM unified_meta ORDER BY key;
SELECT provider, COUNT(*) FROM unified_notes GROUP BY provider ORDER BY provider;
```

## 4) 리허설 체크리스트

- [ ] 백업 파일 생성 확인 (`.sql.gz`)
- [ ] 별도 테스트 DB로 복구 성공
- [ ] `db:verify` 결과가 기대 건수와 일치
- [ ] 앱 구동 후 카드/카테고리/요약 상태 확인

## 5) 장애 대응 순서

1. API 서버 쓰기 중지(배포 중단/운영자 공지)
2. 최신 백업 선택
3. 복구 실행(`db:restore`)
4. 검증 실행(`db:verify` + 앱 smoke test)
5. 정상 확인 후 쓰기 재개

## 6) 주기 정책

- 일 1회 자동 백업(권장)
- 주요 배포 전 수동 백업 1회
- 주 1회 복구 리허설
