# Mac mini 배포 가이드 (잠자기 허용 + 복귀 자동 복구)

업데이트 기준: 2026-02-17

## 목표

- Mac mini는 잠자기 진입 허용
- 깨어난 뒤 API/웹이 자동으로 살아나도록 구성

## 구성

- API: `com.usefulgitinfo.api` (`launchd`)
- WEB: `com.usefulgitinfo.web` (`launchd`, `vite preview` 기반)
- Watchdog: `com.usefulgitinfo.watchdog` (60초 간격 헬스체크, 실패 시 kickstart)

## 1) 전원/복귀 설정

```bash
sudo pmset -a womp 1 tcpkeepalive 1 powernap 1 autorestart 1
pmset -g custom
```

- `womp`: 네트워크 깨우기 허용
- `powernap`: 슬립 중 백그라운드 작업 보조
- `autorestart`: 전원 장애 후 자동 부팅

## 2) 설치

```bash
npm run macos:install
```

설치 시 자동 수행:

1. `npm run build`
2. `npm --prefix server run migrate`
3. LaunchAgent 3종 등록/시작

## 3) 상태 확인

```bash
npm run macos:status
curl http://localhost:4000/api/health
curl -I http://localhost:5173
```

## 4) 잠자기/복귀 검증

1. Mac mini 잠자기 진입
2. 깨운 직후 1~2분 대기
3. 상태 확인:
   - `npm run macos:status`
   - `curl http://localhost:4000/api/health`
   - `curl -I http://localhost:5173`

업무 중(실제 sleep 불가) 대체 검증:

```bash
npm run macos:self-test-resume
npm run macos:check-resume
```

- `macos:self-test-resume`: 프로세스 강제종료 후 watchdog/launchd 자동복구를 3회 반복 검증
- `macos:check-resume`: launchd 상태 + 최근 sleep/wake 로그 + 서비스 헬스 리포트

## 5) 로그 확인

- API: `.runtime/launchd/api.out.log`, `.runtime/launchd/api.err.log`
- WEB: `.runtime/launchd/web.out.log`, `.runtime/launchd/web.err.log`
- Watchdog: `.runtime/launchd/watchdog.out.log`, `.runtime/launchd/watchdog.err.log`

## 6) 제거

```bash
npm run macos:uninstall
```

## 7) 주의사항

- 잠자는 동안에는 외부 접속이 즉시 불가할 수 있음(깨어난 뒤 자동 복구 전제)
- 운영 모드에서는 `server/.env`에 `NODE_ENV=production`, `ADMIN_API_TOKEN` 설정 권장

## 8) GitHub Actions 자동화 (수동 트리거)

- 워크플로우: `.github/workflows/macos-launchd-self-test.yml`
- 트리거: GitHub Actions UI에서 `workflow_dispatch` 수동 실행
- 수행:
  1. macOS runner에 PostgreSQL 준비
  2. launchd agent 설치
  3. `macos:self-test-resume` 실행
  4. launchd/postgres 로그 아티팩트 업로드
