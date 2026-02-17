# PLAN_EXTENTION1: 확장 로드맵 (실행 후보)

업데이트 기준: 2026-02-17

## 1) 목표

안정화된 멀티 보드 구조를 유지하면서 검색 품질, 운영 증적, 데이터 보호 체계를 단계적으로 강화한다.

## 2) Phase 0: 개인용 운영 필수 마감

### WS1. 보안 미완료 닫기 (P0)

- [x] `scan:secrets`(tracked file)
- [x] `scan:secrets:history`(git history)
- [x] `Security History` 워크플로우(수동 + 주간)
- [x] 키 회전 런북(`docs/SECURITY_KEY_ROTATION_RUNBOOK.md`)
- [ ] 실사용 키 회전 증적

### WS2. 백업/복구 리허설 (P0)

- [x] `db:backup / db:restore / db:verify`
- [x] `db:drill` 리허설 자동화
- [x] 리허설 리포트 생성 (`.runtime/drill/*.md`)
- [x] 런북 실행 기록 반영

### WS3. CI 게이트 강제 운영화 (P0)

- [x] CI / Security 워크플로우 운영
- [x] 브랜치 보호 설정 가이드 문서화
- [x] `main` required checks 실제 적용
- [ ] 실패 PR 차단 시나리오 증적 링크

### WS4. INP 중심 성능 운영화 (P1)

- [x] RUM summary API 운영
- [x] 임계치 점검 스크립트(`perf:check-web-vitals`)
- [x] 성능 예산 문서화(`docs/PERF_BUDGETS.md`)
- [ ] 주간 실측 기록 누적

### WS5. 접근성/모바일 QA 루틴 운영 (P1)

- [x] QA 체크리스트/스크립트
- [x] QA 로그 문서
- [ ] 주간 실행 로그 누적

## 3) Phase A: 검색 신뢰도/설명력

- 통합검색 결과 `matchedBy`/score 가시화 토글
- 검색 0건 원인 메시지 분기 강화
- 최근검색 pin/favorite

## 4) Phase B: Bookmark 운영 품질

- 중복 정리 점수화 고도화
- 병합 전 diff + 병합 후 undo
- 대량 처리(batch action)

## 5) Phase C: 데이터 보호/복구

- 백업 복원 dry-run 비교 뷰
- 자동 스냅샷 정책
- 복구 히스토리(시각/버전)

## 6) Phase D: 운영 관측성

- API 계층 지표(search latency, fallback rate)
- 에러 코드 분류 표준화

## 7) 릴리스 기준

- `lint/test/build/e2e` 녹색
- README + PRD + TRD 동기화
- 운영 가이드/증적 문서 업데이트
