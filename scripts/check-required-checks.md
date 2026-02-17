# Required Checks Manual Verification

브랜치 보호가 실제로 동작하는지 확인할 때 사용한다.

## 대상

- branch: `main`
- docs: `docs/BRANCH_PROTECTION_SETUP.md`

## 점검 체크리스트

- [ ] `CI / Quality (lint/test/build)` required 지정
- [ ] `CI / PostgreSQL E2E` required 지정
- [ ] `Security / Secret Scan` required 지정
- [ ] `Security / Dependency Audit` required 지정
- [ ] 실패 PR에서 merge 차단 확인
- [ ] 통과 PR에서 merge 허용 확인
