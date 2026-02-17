# Security Key Rotation Runbook

업데이트 기준: 2026-02-17

## 1) 목적

키 노출 의심 또는 시크릿 스캔 실패 시, 서비스 중단을 최소화하면서 즉시 회전/검증/기록한다.

## 2) 즉시 대응 체크리스트(15분 내)

- [ ] 노출 키 식별(종류/환경/노출 범위)
- [ ] 기존 키 비활성화 또는 권한 축소
- [ ] 신규 키 발급
- [ ] `server/.env`, `.env.local` 교체
- [ ] 서버/프론트 재기동
- [ ] 시크릿 스캔 재실행

```bash
npm run scan:secrets
npm run scan:secrets:history
```

## 3) 서비스별 회전

### 3.1 GitHub

- 대상: `VITE_GITHUB_TOKEN`, `GITHUB_API_TOKEN`
- 절차: PAT revoke -> 신규 PAT 발급 -> 환경변수 교체 -> API 호출 확인

### 3.2 GLM

- 대상: `GLM_API_KEY`
- 절차: 기존 키 폐기 -> 신규 키 발급 -> 요약 재생성 API 확인

### 3.3 YouTube

- 대상: `YOUTUBE_API_KEY`
- 절차: 키 재발급 + referrer/IP 제한 재설정 -> 영상 추가 API 확인

### 3.4 Admin API

- 대상: `ADMIN_API_TOKEN`
- 절차: 32자 이상 랜덤 재생성 -> 보호 API 인증 확인

## 4) 회전 후 검증

- [ ] `npm run scan:secrets` 통과
- [ ] `npm run scan:secrets:history` 통과
- [ ] `npm run lint` 통과
- [ ] `npm run test` 통과
- [ ] 핵심 API smoke test 통과

## 5) 자동 점검 체계

- tracked 파일: `.github/workflows/security.yml`
- history 스캔: `.github/workflows/security-history.yml` (수동 + 주간)

## 6) 사후 조치 기록 템플릿

- 발생 일시:
- 키 종류:
- 노출 범위:
- 조치 완료 시각:
- 후속 재발방지 커밋/PR:
