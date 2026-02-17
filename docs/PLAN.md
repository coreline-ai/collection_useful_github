# PLAN: 현재 구현 상태 + 다음 실행 계획

업데이트 기준: 2026-02-17

## 관련 문서

- `docs/PLAN_EXTENTION1.md`
- `docs/WEBAPP_ESSENTIAL_CHECKLIST_PLAN.md`

## 1) 현재 구현 상태(코드 기준)

### 완료

- 글로벌 탭: `통합검색 / 깃허브 / 유튜브 / 북마크`
- 보드 3종 실동작
  - GitHub: 추가/카테고리/상세/메모/요약 재생성
  - YouTube: 추가/카테고리/요약 재생성/툴팁/링크
  - Bookmark: 추가/카테고리/요약 재생성/중복 정리/링크 점검 API
- PostgreSQL 우선 동기화 + 로컬 fallback + 자동 복구 루프
- 통합검색 relevance 모드(FTS + prefix + trigram + recency)
- 백업/복원 + 리허설(`db:drill`) 체계
- launchd 기반 Mac mini 복귀 자동복구 + GitHub Actions macOS self-test

### 운영 완료 항목(최근)

- 히스토리 시크릿 스캔: `scan:secrets:history`
- 브랜치 보호 required checks 강제 적용(main)
- DB 리허설 증적 생성: `.runtime/drill/*.md`
- Web Vitals 임계치 점검 스크립트: `perf:check-web-vitals`

### 남은 수동 항목

- 실패 PR 1건을 통한 머지 차단 증적(링크/스크린샷) 추가
- 브라우저/모바일 QA 로그 주기 누적
- Web Vitals 실트래픽 주간 기록 누적

## 2) 단기 우선순위

1. 운영 증적 자동화
- 실패 PR 차단 검증 절차 템플릿화
- QA/성능 로그 누적 자동 리마인더

2. 검색 설명력 개선
- `matchedBy`/score 가시화 토글
- 0건 원인 분기 메시지 강화

3. Bookmark 운영 UX 고도화
- 중복 병합 전 비교(diff) 뷰
- 병합 직후 단일 undo

## 3) 품질 게이트(필수)

- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run test:e2e:postgres`
- `npm run scan:secrets`
- `npm run scan:secrets:history`
- `npm run db:drill`

## 4) 변경 규칙

- feature 간 직접 import 금지
- 공통 계약은 `src/core`, `src/shared`로 유지
- 데이터 손실 가능 변경은 문서 + 리허설 증적 필수
- API/상태 필드 변경 시 `README`, `PRD`, `TRD` 동기화
