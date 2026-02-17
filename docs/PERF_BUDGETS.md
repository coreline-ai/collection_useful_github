# Performance Budgets (INP 중심 운영)

업데이트 기준: 2026-02-17

## 1) 임계치 (p75 기준)

- INP < `200ms`
- LCP < `2500ms`
- CLS < `0.1`

## 2) 점검 명령

```bash
npm run perf:check-web-vitals
```

운영에서 인증 토큰이 필요한 경우:

```bash
ADMIN_API_TOKEN=<token> npm run perf:check-web-vitals
```

샘플이 아직 없는 초기 환경에서 실패를 피하려면:

```bash
WEB_VITALS_ALLOW_EMPTY=true npm run perf:check-web-vitals
```

## 3) 스크립트 동작 기준

- API: `/api/admin/rum/web-vitals/summary`
- 기본 기간: 60분
- 값 부족 시 fail (단, `WEB_VITALS_ALLOW_EMPTY=true` + 샘플 0건이면 skip)
- 임계치 초과 시 exit 1

## 4) 초과 시 대응 순서

1. 최근 릴리즈 변경점 확인
2. 주요 경로(카드 리스트/탭 전환/모달) 재측정
3. 원인별 조치
- INP: 긴 동기 작업 분할, 불필요 렌더 감소
- LCP: 초기 요청/이미지/폰트 최적화
- CLS: 썸네일/카드 레이아웃 고정
4. 조치 후 재측정

## 5) 운영 루틴

- 주 1회 정기 측정
- 릴리즈 직후 1회 추가 측정
- 2회 연속 초과 시 성능 개선 작업을 P1로 승격

## 6) 기록 템플릿

- 측정 일시:
- 측정자:
- INP/LCP/CLS 결과:
- 초과 여부:
- 조치 커밋/PR:
