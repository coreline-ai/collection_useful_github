# Mac mini 배포 가이드 (잠자기 허용 + 복귀 자동 복구)

업데이트 기준: 2026-02-17

## 1) 목표

- Mac mini는 잠자기 진입 허용
- 깨어난 뒤 API/Web 자동 복구
- 작업 중 sleep 테스트가 어려운 경우 self-test로 대체 검증

## 2) 구성

- API launchd: `com.usefulgitinfo.api`
- WEB launchd: `com.usefulgitinfo.web` (`vite preview`)
- Watchdog launchd: `com.usefulgitinfo.watchdog` (60초 헬스체크)

## 3) 전원 설정

```bash
sudo pmset -a womp 1 tcpkeepalive 1 powernap 1 autorestart 1
pmset -g custom
```

## 4) 설치

```bash
npm run macos:install
```

설치 시 수행:

1. `npm run build`
2. `npm --prefix server run migrate`
3. LaunchAgent 등록/시작

## 5) 상태 확인

```bash
npm run macos:status
curl http://localhost:4000/api/health
curl -I http://localhost:5173
```

## 6) 복귀 검증

### 6.1 실제 sleep/wake 검증

1. 잠자기 진입
2. wake 후 1~2분 대기
3. 상태/헬스체크 확인

### 6.2 업무 중 대체 검증

```bash
npm run macos:self-test-resume
npm run macos:check-resume
```

- `macos:self-test-resume`: 프로세스 강제종료 후 자동복구 반복 검증
- `macos:check-resume`: launchd 상태 + sleep/wake 로그 + 헬스 리포트

## 7) 로그 위치

- API: `.runtime/launchd/api.out.log`, `.runtime/launchd/api.err.log`
- WEB: `.runtime/launchd/web.out.log`, `.runtime/launchd/web.err.log`
- Watchdog: `.runtime/launchd/watchdog.out.log`, `.runtime/launchd/watchdog.err.log`

## 8) 제거

```bash
npm run macos:uninstall
```

## 9) GitHub Actions self-test

- 워크플로우: `.github/workflows/macos-launchd-self-test.yml`
- 트리거: `workflow_dispatch`
- 검증 범위:
  - macOS runner에서 PostgreSQL 준비
  - launchd 설치
  - `macos:self-test-resume` 실행
  - 로그 아티팩트 업로드

## 10) 운영 권장

- `server/.env`에서 운영 값 유지(`NODE_ENV=production`, `ADMIN_API_TOKEN`)
- 주기적으로 `macos:check-resume` 결과 확인
