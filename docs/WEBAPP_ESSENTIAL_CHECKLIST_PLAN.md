# WEBAPP ESSENTIAL CHECKLIST + 실행 계획

업데이트 기준: 2026-02-16  
목적: 운영 가능한 웹앱 품질 기준을 체크박스 기반으로 관리하고, 단계별 실행을 명확히 한다.

---

## 0) 범위/우선순위

- P0(즉시): 보안/가용성/데이터 무결성
- P1(단기): 성능/관측성/접근성
- P2(중기): 운영 자동화/릴리즈 체계

---

## 1) P0 필수 체크리스트 (보안/운영 안정성)

- [ ] **CSP 및 보안 헤더 강화**
  - 작업:
    - [ ] `Content-Security-Policy` 정책 정의(스크립트/이미지/connect-src 최소권한)
    - [ ] `X-Content-Type-Options: nosniff`
    - [ ] `X-Frame-Options: DENY` 또는 `frame-ancestors 'none'`
    - [ ] `Referrer-Policy: strict-origin-when-cross-origin`
  - 검증:
    - [ ] 브라우저 DevTools `Response Headers` 확인
    - [ ] 주요 기능(YouTube/Bookmark fetch, API 호출) 정상 동작
  - 완료 기준:
    - [ ] 기능 회귀 없이 보안 헤더 적용

- [ ] **관리자 인증 강제 운영 모드 점검**
  - 작업:
    - [ ] `NODE_ENV=production` + `ADMIN_API_TOKEN` 미설정 시 서버 기동 차단 확인
    - [ ] 문서에 운영 환경 필수 변수 명시
  - 검증:
    - [ ] 프로덕션 모드에서 의도된 실패/성공 케이스 테스트
  - 완료 기준:
    - [ ] 무인증 운영 배포 불가 상태 보장

- [ ] **비밀키/민감정보 유출 방지**
  - 작업:
    - [ ] `.env`/`.env.local` git 추적 차단 재점검
    - [ ] 과거 커밋 내 노출 키 탐지(`git log -p`, secret scan)
    - [ ] 노출 의심 키 회전(runbook 포함)
  - 검증:
    - [ ] 저장소 전체 secret scan 결과 0 critical
  - 완료 기준:
    - [ ] 실사용 키 회전 및 문서화 완료

- [ ] **DB 백업/복구 런북**
  - 작업:
    - [ ] 백업 주기 정의(일/주 단위)
    - [ ] 복구 절차 문서화(restore 순서, 검증 SQL)
    - [ ] 복구 리허설 1회 수행
  - 검증:
    - [ ] 리허설 후 카드/카테고리/노트 정상 복원
  - 완료 기준:
    - [ ] 장애 시 복구 가능 시간(RTO) 및 데이터 손실 범위(RPO) 명시

- [ ] **CI 게이트 강제**
  - 작업:
    - [ ] PR 머지 조건으로 `lint/test/build/test:e2e:postgres` 필수화
  - 검증:
    - [ ] 실패 시 머지 차단 확인
  - 완료 기준:
    - [ ] 무검증 머지 불가

---

## 2) P1 필수 체크리스트 (성능/UX/관측)

- [ ] **SEO 운영 파일 완성**
  - 작업:
    - [ ] `public/robots.txt` 추가
    - [ ] `public/sitemap.xml` 추가
    - [ ] `public/manifest.webmanifest` 추가
  - 검증:
    - [ ] `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest` 200 응답
  - 완료 기준:
    - [ ] 검색엔진 크롤링 기본 요건 충족

- [ ] **Web Vitals 수집 운영화**
  - 작업:
    - [ ] `WEB_VITALS_ENABLED=true` 운영 환경 적용
    - [ ] 저장소/로그 대시보드 연결(평균/90p LCP, INP, CLS)
  - 검증:
    - [ ] 실제 접속에서 vitals 이벤트 수집 확인
  - 완료 기준:
    - [ ] 성능 저하 감지 가능한 상태

- [ ] **접근성(A11y) 점검**
  - 작업:
    - [ ] 모달 포커스 트랩
    - [ ] ESC 닫기/포커스 복귀
    - [ ] 키보드-only 탭 이동
    - [ ] 명도 대비 점검(WCAG AA)
  - 검증:
    - [ ] axe/lighthouse 접근성 검사
  - 완료 기준:
    - [ ] 치명 접근성 이슈 0

- [ ] **이미지/렌더 안정성**
  - 작업:
    - [ ] 썸네일 이미지 `width/height` 또는 `aspect-ratio` 고정 점검
    - [ ] `loading="lazy"` + `decoding="async"` 검토
    - [ ] 실패 이미지 placeholder 통일
  - 검증:
    - [ ] CLS 지표 악화 없음
  - 완료 기준:
    - [ ] 이미지 로드 시 레이아웃 점프 최소화

- [ ] **API 보호 범위 확장**
  - 작업:
    - [ ] 검색 외 엔드포인트 rate-limit 정책 추가 검토
    - [ ] 민감 route abuse 방어(요청 크기/빈도 제한)
  - 검증:
    - [ ] 부하 시나리오에서 서버 응답 안정성 확인
  - 완료 기준:
    - [ ] 비정상 트래픽 대응 가능

---

## 3) P2 체크리스트 (운영 고도화)

- [ ] **릴리즈/롤백 체계**
  - 작업:
    - [ ] 버전 태깅 규칙
    - [ ] CHANGELOG 자동화
    - [ ] 롤백 절차 문서화

- [ ] **의존성 보안 자동화**
  - 작업:
    - [ ] Dependabot/Renovate 적용
    - [ ] `npm audit` CI 연동

- [ ] **로그 표준화**
  - 작업:
    - [ ] request-id
    - [ ] JSON 구조 로그
    - [ ] 민감정보 마스킹

- [ ] **호환성/모바일 QA 루틴**
  - 작업:
    - [ ] Chrome/Edge/Safari/Firefox 기본 시나리오
    - [ ] 모바일 터치/키보드 오버랩 점검

---

## 4) 실행 순서(권장)

### Phase 1 (1~2일)
- [ ] P0 전부 수행: 보안 헤더, 운영 토큰 강제 검증, 시크릿 스캔, CI 게이트

### Phase 2 (2~3일)
- [ ] P1 핵심: robots/sitemap/manifest, A11y 보강, 이미지 안정화, vitals 운영 연결

### Phase 3 (지속)
- [ ] P2 자동화: 릴리즈/로그/의존성/호환성 루틴 상시화

---

## 5) 테스트/검증 명령어 표준

- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] `npm run test:e2e:postgres`
- [ ] (서버) `node --check server/src/index.js`

완료 판정: 상기 명령어 전부 통과 + P0 체크박스 100% 완료.

