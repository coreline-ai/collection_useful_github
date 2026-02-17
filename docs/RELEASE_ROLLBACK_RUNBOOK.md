# Release / Rollback Runbook

업데이트 기준: 2026-02-17

## 1) 버전 태깅 규칙

- 형식: `vMAJOR.MINOR.PATCH` (예: `v1.4.2`)
- 기준:
  - MAJOR: 하위호환 깨짐
  - MINOR: 기능 추가
  - PATCH: 버그/운영 안정화

## 2) 릴리즈 전 게이트

```bash
npm run lint
npm run test
npm run build
npm run test:e2e:postgres
npm run scan:secrets
npm run scan:secrets:history
npm run audit:deps
npm run db:drill
```

## 3) 릴리즈 절차

1. `main` 최신 동기화
2. 변경 요약 생성

```bash
npm run release:changelog
```

3. `CHANGELOG.md` 업데이트
4. 버전 태그 생성/푸시

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

5. 배포

## 4) 롤백 절차

1. 현재 배포 버전 확인
2. 이전 안정 태그 선택
3. 데이터 보호

```bash
npm run db:backup
```

4. 코드 롤백(태그 기준)
5. 필요 시 DB 복구

```bash
npm run db:restore -- --input backups/<backup>.sql.gz
npm run db:verify
```

6. 상태 확인

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/health/deep
```

## 5) 장애 커뮤니케이션 체크

- 장애 시작 시각
- 영향 범위(provider/기능)
- 임시 조치
- 최종 원인
- 재발 방지 조치
