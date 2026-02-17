# Branch Protection Setup (main)

업데이트 기준: 2026-02-17

## 1) 목적

`main` 브랜치에 검증 실패 코드가 병합되지 않도록 Required checks를 강제한다.

## 2) 설정 경로

1. Repository Settings
2. Branches
3. Add rule (`main`)

## 3) 권장 규칙

- Require a pull request before merging
- Require approvals (최소 1)
- Dismiss stale reviews on new commits
- Require status checks to pass
- Require branches to be up to date
- Require conversation resolution
- Do not allow bypassing above settings

## 4) Required checks

1. `CI / Quality (lint/test/build)`
2. `CI / PostgreSQL E2E`
3. `Security / Secret Scan`
4. `Security / Dependency Audit`

권장:

5. `Security History / Secret History Scan`

## 5) 적용 증적(현재 상태)

- 적용 일시: 2026-02-17 14:17 UTC
- 적용 방법: `gh api` via branch protection API
- 대상 브랜치: `main`
- 확인값:
  - `strict=true`
  - `required_approving_review_count=1`
  - `enforce_admins=true`
  - `required_conversation_resolution=true`

## 6) 남은 검증

- 실패 PR 1건 생성 후 merge 차단 화면/링크를 기록

템플릿:

- 실패 PR 링크:
- 차단 스크린샷 경로:
- 해결 후 통과 PR 링크:
