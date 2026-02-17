# Changelog

모든 주요 변경은 이 문서에 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)와 SemVer를 따릅니다.

## [Unreleased]

### Added
- P0/P1 웹앱 필수 체크리스트 운영 자동화 기반 추가:
  - API 보안 헤더/CSP 적용
  - request-id + JSON 구조 로그
  - API rate limit 범위 확장
  - SEO 기본 파일(`robots.txt`, `sitemap.xml`, `manifest.webmanifest`)
  - 모달 포커스 트랩
  - 시크릿 스캔 스크립트 및 보안 CI
  - DB 백업/복구 런북 및 스크립트
  - 릴리즈/롤백, 브라우저/모바일 QA 문서

### Changed
- Web Vitals 수집 운영화:
  - `/api/admin/rum/web-vitals/summary`
  - `/api/admin/rum/web-vitals/samples` (DELETE)
