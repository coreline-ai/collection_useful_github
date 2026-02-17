# WEBAPP ESSENTIAL CHECKLIST + 실행 계획

업데이트 기준: 2026-02-17

상태 표기:

- `[x]` 완료
- `[ ] [부분]` 부분완료
- `[ ]` 미완료

## 0) 범위/우선순위

- P0: 보안/가용성/데이터 무결성
- P1: 성능/관측성/접근성
- P2: 운영 자동화/릴리즈 체계

## 1) P0 필수 체크리스트

- [x] CSP 및 보안 헤더 강화
- [x] production 무인증 기동 차단 (`ADMIN_API_TOKEN`)

- [ ] [부분] 비밀키/민감정보 유출 방지
  - [x] tracked-file 시크릿 스캔 (`scan:secrets`)
  - [x] history 시크릿 스캔 (`scan:secrets:history`)
  - [x] security-history workflow
  - [x] 키 회전 런북
  - [ ] 실사용 키 회전 증적

- [x] DB 백업/복구 런북
  - [x] `db:backup`, `db:restore`, `db:verify`
  - [x] `db:drill` 리허설
  - [x] 리허설 증적 기록

- [ ] [부분] CI 게이트 강제
  - [x] CI(`lint/test/build/e2e`) 운영
  - [x] 보안 워크플로우 운영
  - [x] branch protection required checks 적용(main)
  - [ ] 실패 PR 차단 증적 링크

## 2) P1 필수 체크리스트

- [x] SEO 운영 파일 (`robots.txt`, `sitemap.xml`, `manifest.webmanifest`)

- [ ] [부분] Web Vitals 운영화
  - [x] 수집/요약 API
  - [x] 임계치 점검 스크립트
  - [x] 성능 예산 문서
  - [ ] 실트래픽 주간 기록

- [ ] [부분] 접근성(A11y)
  - [x] 모달 포커스 트랩 + ESC
  - [x] 탭 role/aria 점검
  - [ ] 키보드-only 전수 점검
  - [ ] 명도 대비(WCAG AA) 리포트

- [ ] [부분] 이미지/렌더 안정성
  - [x] 썸네일 비율 고정
  - [x] lazy/async 디코딩
  - [x] placeholder 통일
  - [ ] CLS 추이 기록

- [ ] [부분] API 보호 범위 확장
  - [x] 검색 외 rate limit 버킷
  - [x] request body size 제한
  - [x] request-id + JSON 에러 로그
  - [ ] 부하 테스트 자동화

## 3) P2 체크리스트

- [x] 릴리즈/롤백 런북
- [x] 의존성 보안 자동화
- [x] 로그 표준화

- [ ] [부분] 브라우저/모바일 QA 루틴
  - [x] QA 체크리스트
  - [x] QA 스크립트
  - [x] QA 로그 문서
  - [ ] 주기 로그 누적

## 4) 검증 명령어 표준

- [x] `npm run lint`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run test:e2e:postgres`
- [x] `npm run scan:secrets`
- [x] `npm run scan:secrets:history`
- [x] `npm run db:drill`
- [x] `npm run perf:check-web-vitals`
- [x] `npm run audit:deps`

## 5) 증적 문서 위치

- 백업/복구: `docs/DB_BACKUP_RESTORE_RUNBOOK.md`
- 브랜치 보호: `docs/BRANCH_PROTECTION_SETUP.md`
- 성능 예산: `docs/PERF_BUDGETS.md`
- QA 로그: `docs/QA_BROWSER_MOBILE_LOG.md`
- 보안 키 회전: `docs/SECURITY_KEY_ROTATION_RUNBOOK.md`
