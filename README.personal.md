# Coreline 개인 자료함 · Workers + D1

원본 main과 PostgreSQL/AI 앱은 그대로 두고, `codex/cloudflare-personal-free` 브랜치에 독립적인 개인용 빌드를 추가했습니다. 기존 DB 자료는 자동 이관하지 않습니다.

- 서비스: https://coreline-free-hosting.corelineailab.workers.dev
- 로그인: GitHub `coreline-ai` 본인만 허용(사용자 ID 고정), 이메일 OTP 방식 아님.
- 기능: GitHub/YouTube/북마크 등록·수정, 공개 정보 가져오기, 카테고리·태그·메모·고정·검색, 휴지통 복원, JSON 백업/가져오기.
- AI 요약/번역, GLM/OpenAI/NotebookLM, 유료 API·외부 추적·서버 예약 작업은 개인용 빌드에 없습니다.
- 무료 앱 한도: 휴지통 포함 500개. 영구 삭제 버튼은 없습니다. 휴지통은 복원 가능하며 JSON 백업에는 활성 자료만 포함됩니다.
- 가져오기는 이 개인용 버전의 JSON 형식만 지원합니다. 원본 DB/원본 앱 백업을 직접 가져오는 기능은 아닙니다. 중복 URL은 덮어쓰지 않습니다.

## 구조

| 경로                                              | 역할                                                    |
| ------------------------------------------------- | ------------------------------------------------------- |
| `personal/`                                       | React 카드 UI, 공유 검증, UTF-8 크기 기반 가져오기 배치 |
| `worker/`                                         | GitHub OAuth/PKCE, D1 CRUD, CSRF·버전 충돌·입력 검증    |
| `migrations/`                                     | 독립 D1 스키마                                          |
| `wrangler.jsonc`                                  | Worker/D1 바인딩, 공개 설정. 비밀키 없음                |
| `vite.personal.config.ts`                         | 원본과 분리된 빌드, 기존 VITE_/GLM_ 환경변수 노출 없음  |
| `personal-tests/`, `scripts/personal/preview.mjs` | 합성 데이터 로컬 검증 전용. 배포에 포함되지 않음        |

## 무료 범위와 주의

현재 Workers Free를 유지하며 카드 등록, 유료 전환, Zero Trust 구독을 진행하지 않습니다. 기본 workers.dev 주소를 사용하므로 도메인 구매가 필요 없습니다.

무료가 무제한을 의미하지는 않습니다. 공식 문서 기준 Workers Free는 100,000 요청/일, D1 Free는 5백만 행 읽기/일·10만 행 쓰기/일·총 5GB 및 DB당 500MB입니다. Free 한도 초과 시 기능이 제한될 수 있으며, 이 배포가 자동으로 Paid 플랜으로 업그레이드하지는 않습니다. 향후 계정 플랜을 직접 바꾸면 요금 정책도 바뀝니다.

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/

정적 파일도 인증을 거치므로 Worker 요청 수에 포함됩니다. 검색은 최대 500개 개인 자료에 맞춘 바인딩 SQL 검색이며, 원본 PostgreSQL 전문검색 엔진과 다릅니다. 메타데이터는 공개 GitHub API/YouTube oEmbed만 호출하므로 해당 서비스 제한 시 직접 제목을 입력하세요. 일반 북마크는 서버가 URL 내용을 가져오지 않습니다.

## 로그인과 데이터 보호

GitHub OAuth 앱은 공개 프로필 확인만 사용합니다(`scope` 비움). 비공개 저장소 권한을 요청하지 않습니다. GitHub 토큰은 사용자 식별 후 저장하지 않습니다. 애플리케이션 세션은 7일, HttpOnly/Secure/SameSite 쿠키이며 DB에는 토큰 해시만 저장합니다. 변경 요청은 동일 Origin과 세션 CSRF 토큰을 확인합니다.

서버 비밀값 `GITHUB_CLIENT_SECRET`은 Cloudflare Worker Secret에만 저장합니다. 설정 누락·인증 실패 시 데이터와 개인 화면 모두 차단합니다. 사용자 ID가 일치하지 않으면 GitHub 로그인이 성공해도 앱 접근은 거부됩니다. 로컬 브라우저에는 테마 설정만 저장하며, 자료는 D1에서 읽습니다.

백업 JSON은 메모를 포함하는 개인 자료입니다. 안전한 위치에 보관하고 공개 저장소에 올리지 마세요. 원본 PostgreSQL DB/환경변수는 이 앱이 읽거나 수정하지 않습니다.

## 테스트

Node.js 24 권장. 원본 회귀 테스트에는 server 의존성도 필요합니다.

```sh
npm ci
npm --prefix server ci
npm run personal:bundle
npm run personal:test
npm run personal:test:integration
npm test
npm run build
```

브라우저 검수용 합성 DB/계정은 `node scripts/personal/preview.mjs`로 `http://127.0.0.1:8788`에서만 실행합니다. 인증을 대신 주입하는 **테스트 전용 프록시**이므로 외부에 공개하거나 배포하지 마세요. 실제 Worker에는 테스트 인증 우회 경로가 없습니다.

## 재배포

배포는 수동 CLI 방식입니다. GitHub Push가 자동으로 실서비스를 덮어쓰지 않으며 별도 유료 CI를 만들지 않습니다.

```sh
npx wrangler login --use-keyring --scopes account:read user:read workers_scripts:write d1:write
npm run personal:db:remote
npx wrangler secret put GITHUB_CLIENT_SECRET
npm run personal:deploy
```

다른 계정으로 복제할 경우 Worker 이름/account_id/D1 ID/APP_ORIGIN/OWNER_GITHUB_ID/GITHUB_CLIENT_ID와 OAuth callback URL을 모두 바꾸세요. Secret은 셸 인수나 파일이 아닌 CLI 숨김 입력으로 설정합니다. 원본 `npm run build`가 아니라 `personal:build`의 산출물만 배포해야 합니다.

## 검증 결과 (2026-10-13)

개인용 단위 7개 + 통합 14개 통과. 원본 회귀 170개 통과/15개 환경 의존 skip. 개인용/원본 빌드 성공. 로컬 실제 workerd+D1 및 Chrome에서 등록, 새로고침 유지, 휴지통/복원, 390px 모바일, 다크모드 확인.

개인용 root 의존성 audit 0. 원본 server의 기존 audit 6건(critical 1 포함)은 별도 과제이며, 해당 Node 서버·패키지는 이 Worker에 배포하지 않습니다.
