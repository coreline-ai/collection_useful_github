# PLAN: 현재 구현 상태 + 다음 실행 계획

업데이트 기준: 2026-02-16

## 1. 현재 구현 상태(코드 기준)

### 완료

- 글로벌 탭 분리: `통합검색/깃허브/유튜브/북마크`
- 보드 3종 실동작:
  - GitHub: 추가/카테고리/상세/메모/번역
  - YouTube: 추가/카테고리/검색/링크 중심 카드
  - Bookmark: 추가/카테고리/검색/중복 정리 도우미
- 원격 저장(PostgreSQL) + 로컬 fallback + 자동 복구
- 통합검색 relevance 모드(FTS + prefix + trigram + recency)
- 백업 내보내기/복원
- 테마(light/dark) + 동기화 상태 배지
- Postgres E2E 스크립트 분리

### 주의

- 북마크 `link-check` API는 서버에 존재하지만, 현재 카드 UI에서는 점검 버튼을 노출하지 않음
- 북마크 중복 정리 정확도는 `resolved/canonical/content` 휴리스틱에 의존

## 2. 단기 우선순위

1. Bookmark 중복 정리 UX 고도화
- 병합 전 diff 미리보기
- 병합 후 undo(단일 스텝)

2. 통합검색 결과 UX 고도화
- score/matchedBy 디버그 표시 토글
- 필터 preset 저장

3. 운영 가시성 강화
- `/api/metrics` 또는 내부 로깅 집계
- 검색 latency / fallback 발생률 대시보드화

## 3. 테스트/품질 체크리스트

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e:postgres`

모든 변경은 위 4개를 기본 게이트로 유지.

## 4. 변경 시 규칙

- feature 간 직접 import 금지
- 공유 타입/유틸은 `shared` 또는 `core`로 이동
- 원격 실패 메시지 문구는 행동 유도형으로 유지
- 데이터 손실 가능 변경 시 반드시 마이그레이션 경로 문서화
