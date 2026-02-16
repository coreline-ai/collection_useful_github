# PLAN_EXTENTION1: 확장 로드맵 (실행 후보)

업데이트 기준: 2026-02-16

## 1. 목표

현재 안정화된 멀티 보드 구조 위에서 검색 품질, 데이터 정합성, 운영 가시성을 단계적으로 강화한다.

## 2. 단계별 확장

## Phase A: 검색 신뢰도/설명력

- 통합검색 결과에 `왜 매칭되었는지` 표시 강화
  - `matchedBy` 뱃지 가시화(exact/prefix/fts/trgm)
- 검색 실패 진단 UI 추가
  - 필터 과도 제한, 원격 비활성, 0건 원인 분기
- 최근검색 재사용 UX 개선
  - pin/favorite query

## Phase B: Bookmark 운영 품질

- 중복 정리 고도화
  - 제목 유사도 + canonical + resolved URL 가중치 모델
  - 병합 제안 점수화
- 대량 북마크 처리
  - 카테고리 단위 batch action
  - 도메인 기준 정렬/필터

## Phase C: 데이터 보호/복구

- 백업 복원 dry-run 모드
  - 실제 반영 전 차이점 preview
- 자동 스냅샷 정책
  - N시간 주기 meta 스냅샷
- 복구 히스토리
  - 마지막 복원 시각/버전 기록

## Phase D: 운영 관측성

- API 계층 관측 지표
  - search latency
  - remote save 실패율
  - fallback 전환 횟수
- 에러 코드 분류 체계 표준화

## 3. 기술 부채 정리 후보

- 보드 Entry 3종 중복 로직 공통 hook 추출
  - sync/fallback/recovery 상태머신 공통화
- CSS 구조 모듈화
  - feature별 스타일 분리(`github.css/youtube.css/bookmark.css`)
- API 응답 스키마 검증 강화
  - zod 등 런타임 validator 도입 검토

## 4. 릴리스 기준

각 phase 완료 조건:

- 단위/통합/빌드/E2E 모두 녹색
- README/PRD/TRD 반영
- 운영 가이드(장애/복구 절차) 업데이트
