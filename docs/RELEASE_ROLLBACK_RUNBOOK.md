# Release / Rollback Runbook

업데이트 기준: 2026-02-17

## 1) 버전 태깅 규칙

- 형식: `vMAJOR.MINOR.PATCH` (예: `v1.4.2`)
- 기준:
  - MAJOR: 하위호환 깨짐
  - MINOR: 기능 추가(하위호환 유지)
  - PATCH: 버그 수정/운영 안정화

## 2) 릴리즈 전 게이트

```bash
npm run lint
npm test
npm run build
npm run test:e2e:postgres
npm run scan:secrets
npm run audit:deps
```

모든 명령 통과 시에만 릴리즈.

## 3) 릴리즈 절차

1. `main` 최신 동기화
2. 변경 요약 생성:
   ```bash
   npm run release:changelog
   ```
3. `CHANGELOG.md` 업데이트
4. 버전 태그 생성:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
5. 배포

## 4) 롤백 절차

1. 현재 배포 버전/태그 확인
2. 이전 안정 태그 확인
3. 데이터 보호:
   ```bash
   npm run db:backup
   ```
4. 코드 롤백(태그 기준 재배포)
5. 필요 시 DB 복구:
   ```bash
   npm run db:restore -- --input backups/<backup>.sql.gz
   npm run db:verify
   ```
6. 서비스 상태 확인(`/api/health`, 주요 보드 스모크 테스트)

## 5) 장애 커뮤니케이션 체크

- 장애 시작 시각
- 영향 범위(Provider/기능/사용자)
- 임시 조치
- 최종 원인
- 재발 방지 조치
