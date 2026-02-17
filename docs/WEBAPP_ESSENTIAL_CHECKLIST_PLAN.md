# WEBAPP ESSENTIAL CHECKLIST + 실행 계획

업데이트 기준: 2026-02-17  
목적: 운영 가능한 웹앱 품질 기준을 체크박스 기반으로 관리하고, 단계별 실행을 명확히 한다.

상태 표기:

- `[x]` 완료
- `[ ] [부분]` 부분완료
- `[ ]` 미완료

---

## 0) 범위/우선순위

- P0(즉시): 보안/가용성/데이터 무결성
- P1(단기): 성능/관측성/접근성
- P2(중기): 운영 자동화/릴리즈 체계

---

## 1) P0 필수 체크리스트 (보안/운영 안정성)

- [x] **CSP 및 보안 헤더 강화**
  - 작업:
    - [x] `Content-Security-Policy` 정책 정의(스크립트/이미지/connect-src 최소권한)
    - [x] `X-Content-Type-Options: nosniff`
    - [x] `X-Frame-Options: DENY` 또는 `frame-ancestors 'none'`
    - [x] `Referrer-Policy: strict-origin-when-cross-origin`
  - 검증:
    - [x] `curl -I`로 API 응답 헤더 확인
    - [x] `node --check server/src/index.js`, 핵심 테스트 통과
  - 완료 기준:
    - [x] 기능 회귀 없이 보안 헤더 적용

- [x] **관리자 인증 강제 운영 모드 점검**
  - 작업:
    - [x] `NODE_ENV=production` + `ADMIN_API_TOKEN` 미설정 시 서버 기동 차단
    - [x] 문서에 운영 환경 필수 변수 명시
  - 검증:
    - [x] production 미설정 토큰 시 실패 케이스 확인
  - 완료 기준:
    - [x] 무인증 운영 배포 불가 상태 보장

- [ ] [부분] **비밀키/민감정보 유출 방지**
  - 작업:
    - [x] `.env`/`.env.local` git 추적 차단 재점검
    - [x] tracked-file 기반 secret scan 스크립트/CI(`scan:secrets`, `security.yml`) 추가
    - [ ] 과거 커밋 내 노출 키 탐지(`git log -p`, 외부 secret scan)
    - [ ] 노출 의심 키 회전(runbook 포함)
  - 검증:
    - [x] `npm run scan:secrets` 통과
    - [ ] 과거 히스토리 스캔 0 critical
  - 완료 기준:
    - [ ] 실사용 키 회전 및 문서화 완료

- [ ] [부분] **DB 백업/복구 런북**
  - 작업:
    - [x] 백업/복구 주기 정의 문서화
    - [x] 복구 절차 문서화(`docs/DB_BACKUP_RESTORE_RUNBOOK.md`)
    - [x] 실행 스크립트 추가(`db:backup`, `db:restore`, `db:verify`)
    - [ ] 복구 리허설 1회 수행
  - 검증:
    - [ ] 리허설 후 카드/카테고리/노트 정상 복원
  - 완료 기준:
    - [ ] 장애 시 복구 가능 시간(RTO) 및 데이터 손실 범위(RPO) 실제 리허설로 확인

- [ ] [부분] **CI 게이트 강제**
  - 작업:
    - [x] CI에서 `lint/test/build/test:e2e:postgres` 실행
    - [x] 보안 워크플로우(`scan:secrets`, `audit:deps`) 추가
    - [ ] 브랜치 보호 규칙에서 required checks 강제
  - 검증:
    - [ ] GitHub branch protection에서 실패 시 머지 차단 확인
  - 완료 기준:
    - [ ] 무검증 머지 불가

---

## 2) P1 필수 체크리스트 (성능/UX/관측)

- [x] **SEO 운영 파일 완성**
  - 작업:
    - [x] `public/robots.txt` 추가
    - [x] `public/sitemap.xml` 추가
    - [x] `public/manifest.webmanifest` 추가
  - 검증:
    - [x] build 결과물에 파일 포함 확인
  - 완료 기준:
    - [x] 검색엔진 크롤링 기본 요건 충족

- [ ] [부분] **Web Vitals 수집 운영화**
  - 작업:
    - [x] `WEB_VITALS_ENABLED` 기반 수집 활성화 경로 유지
    - [x] 관리자 요약 API 추가(`/api/admin/rum/web-vitals/summary`)
    - [x] 샘플 초기화 API 추가(`/api/admin/rum/web-vitals/samples`)
    - [ ] 외부 로그/대시보드 시스템 연동
  - 검증:
    - [ ] 운영 접속 트래픽에서 주간 추이 확인
  - 완료 기준:
    - [ ] 성능 저하 자동 감지 가능한 상태

- [ ] [부분] **접근성(A11y) 점검**
  - 작업:
    - [x] 모달 포커스 트랩
    - [x] ESC 닫기/포커스 복귀
    - [x] 탭 컴포넌트 role/aria 속성 점검
    - [ ] 전 화면 키보드-only 탐색 시나리오 전수 점검
    - [ ] 명도 대비 점검(WCAG AA) 리포트화
  - 검증:
    - [ ] axe/lighthouse 접근성 검사 기록
  - 완료 기준:
    - [ ] 치명 접근성 이슈 0

- [ ] [부분] **이미지/렌더 안정성**
  - 작업:
    - [x] 썸네일 `width/height` 또는 비율 고정
    - [x] `loading=\"lazy\"` + `decoding=\"async\"` 적용
    - [x] 실패 이미지 placeholder 통일
  - 검증:
    - [ ] CLS 지표 추이 확인
  - 완료 기준:
    - [ ] 이미지 로드 시 레이아웃 점프 최소화

- [ ] [부분] **API 보호 범위 확장**
  - 작업:
    - [x] 검색 외 엔드포인트 rate-limit 버킷 추가
    - [x] 요청 크기 제한(`express.json({limit: '8mb'})`)
    - [x] request-id + JSON 에러 로그
    - [ ] 부하 테스트 시나리오 문서/자동화
  - 검증:
    - [ ] 부하 시나리오에서 응답 안정성 확인
  - 완료 기준:
    - [ ] 비정상 트래픽 대응 가능

---

## 3) P2 체크리스트 (운영 고도화)

- [x] **릴리즈/롤백 체계**
  - 작업:
    - [x] 버전 태깅 규칙 문서화
    - [x] CHANGELOG 파일 생성 + 릴리즈 요약 스크립트(`release:changelog`)
    - [x] 롤백 절차 문서화(`docs/RELEASE_ROLLBACK_RUNBOOK.md`)

- [x] **의존성 보안 자동화**
  - 작업:
    - [x] Dependabot 설정(`.github/dependabot.yml`)
    - [x] `npm audit` CI 연동(`security.yml`)

- [x] **로그 표준화**
  - 작업:
    - [x] request-id 부여/응답 헤더 반영
    - [x] JSON 구조 로그
    - [x] 민감정보 마스킹

- [ ] [부분] **호환성/모바일 QA 루틴**
  - 작업:
    - [x] 체크리스트 문서(`docs/QA_BROWSER_MOBILE_CHECKLIST.md`)
    - [x] 실행 스크립트(`qa:browser-mobile`)
    - [ ] 브라우저별 정기 실행 결과 누적

---

## 4) 실행 순서(권장)

### Phase 1 (완료)
- [x] P0 코드/워크플로우 기반 안정화 1차 적용

### Phase 2 (진행중)
- [ ] [부분] 운영 수동 검증(복구 리허설, branch protection, 대시보드 연동)

### Phase 3 (지속)
- [ ] 주기적 QA 실행 결과 기록 + 보안/복구 리허설 정례화

---

## 5) 테스트/검증 명령어 표준

- [x] `npm run lint`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run test:e2e:postgres`
- [x] `node --check server/src/index.js`
- [x] `npm run scan:secrets`
- [x] `npm run audit:deps`

완료 판정: 상기 명령어 전부 통과 + P0 항목 수동 검증(리허설/branch protection) 완료.
