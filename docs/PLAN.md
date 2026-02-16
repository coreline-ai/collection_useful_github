## GitHub 카드 대시보드 구현 계획 (React + Vite, localStorage)

### 요약
사용자가 GitHub 저장소 URL을 입력하면 저장소 정보를 카드로 생성하고, 4열 그리드로 표시합니다. 페이지당 12개를 노출하며 12개 초과 시 숫자 페이지네이션(이전/다음 포함)을 제공합니다. 카드에는 핵심 정보와 요약, 링크, 인기도 지표를 표시하고, 클릭 시 GitHub 스타일에 가까운 상세 메타 팝업 + 하단 메모 입력/기록 영역을 제공합니다. 카드 삭제 기능과 상태 영속화(localStorage)를 포함합니다.

### 범위
1. 포함 범위: 저장소 URL 입력, 카드 생성/조회/삭제, 4열 그리드, 페이지네이션, 상세 팝업, 메모 작성/목록, 로컬 저장.
2. 제외 범위: 서버 구축, 사용자 계정 로그인, 다중 디바이스 동기화, 조직/사용자 전체 URL 일괄 수집.

### 기술/구조 결정
1. 프레임워크: `React + Vite`.
2. 언어: `TypeScript`로 고정.
3. 상태 관리: `useReducer + custom hooks`.
4. 데이터 저장: `localStorage`.
5. 정렬: `입력 순서 유지` (최신 추가가 목록 하단).
6. URL 정책: `owner/repo` 단위만 허용, 중복 저장소 차단.
7. 페이지 UI: `숫자 페이지 + 이전/다음`.
8. GitHub 인증: 기본 무인증 호출, `VITE_GITHUB_TOKEN` 있으면 자동 사용(옵션 지원).

### 공개 인터페이스/타입(중요)
1. `GitHubRepoCard`
```ts
type GitHubRepoCard = {
  id: string; // full_name lower-case, e.g. "facebook/react"
  owner: string;
  repo: string;
  fullName: string;
  description: string;
  summary: string;
  htmlUrl: string;
  homepage: string | null;
  language: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  topics: string[];
  license: string | null;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  addedAt: string; // 입력 시각 (정렬 기준)
};
```
2. `RepoNote`
```ts
type RepoNote = {
  id: string;
  repoId: string; // GitHubRepoCard.id
  content: string;
  createdAt: string;
};
```
3. 저장 키
- `localStorage["github_cards_v1"]`: `GitHubRepoCard[]`
- `localStorage["github_notes_v1"]`: `Record<string, RepoNote[]>`
4. 핵심 함수 시그니처
- `parseGitHubRepoUrl(input: string): { owner: string; repo: string } | null`
- `fetchRepo(owner: string, repo: string): Promise<GitHubRepoCard>`
- `fetchReadme(owner: string, repo: string): Promise<string | null>`
- `buildSummary(description: string, readme: string | null): string`
- `paginate<T>(items: T[], page: number, perPage: number): T[]`

### UI/화면 사양
1. 상단 입력 바
- URL 입력창 + `추가` 버튼 + 엔터 제출.
- 유효성 실패 시 인라인 에러 표시.
2. 카드 그리드
- 데스크톱: 4열 고정.
- 카드 정보: 저장소명, owner, 요약, 언어, stars/forks/watchers/open issues, 업데이트일, GitHub 링크.
- 카드 액션: `상세 보기`, `삭제`.
3. 페이지네이션
- `perPage = 12`.
- 13개부터 새 페이지 생성.
- 숫자 버튼 + 이전/다음.
- 삭제 후 현재 페이지가 비면 이전 페이지로 자동 이동.
4. 상세 팝업(모달)
- 핵심 메타 정보 표시: 저장소명, 설명, stars/forks/watchers/issues, language, topics, license, default branch, created/updated, GitHub 링크/homepage.
- 하단 메모 섹션: 텍스트 입력 + `입력` 버튼.
- 입력 시 즉시 하단 리스트에 누적 표시(시간 포함).
5. 반응형
- 태블릿/모바일에서는 열 수를 줄이되, 데스크톱에서 4열 요구 보장.

### 데이터 흐름
1. 사용자 URL 입력.
2. URL 파싱/검증 후 중복 검사(`id = owner/repo lower-case`).
3. GitHub API 호출로 저장소 메타 획득.
4. README 일부(가능 시) + description 기반 규칙 요약 생성.
5. 카드 상태 반영 후 `localStorage` 동기화.
6. 카드 클릭 시 모달 오픈, 메모 입력/조회/저장.
7. 카드 삭제 시 카드 + 연결 메모 동시 삭제, 페이지 보정.

### GitHub API 연동 상세
1. 저장소 정보: `GET /repos/{owner}/{repo}`.
2. README: `GET /repos/{owner}/{repo}/readme` (base64 decode).
3. 헤더
- `Accept: application/vnd.github+json`
- `Authorization: Bearer ${VITE_GITHUB_TOKEN}` (환경변수 있을 때만)
4. 요약 규칙
- description 우선.
- README 첫 본문 단락/헤더 기반 핵심 문장 1~2개 추출.
- 최종 180~220자 내로 절삭.
5. 실패 처리
- README 실패 시 description-only 요약으로 폴백.
- 404/403/rate limit 메시지 분기 출력.

### 엣지 케이스/실패 모드
1. URL 변형 처리: `https://github.com/owner/repo`, `github.com/owner/repo`, trailing slash, query 제거.
2. 중복 입력 차단: 기존 카드면 “이미 추가됨” 안내.
3. 비공개/없는 저장소: 카드 생성 실패 + 오류 안내.
4. API 제한 초과: 토큰 설정 유도 메시지 표시.
5. 메모 공백 입력 차단, 최대 길이(예: 500자) 제한.
6. XSS 방지: 메모/요약은 plain text 렌더링.

### 테스트 케이스/시나리오
1. URL 파서 단위 테스트
- 정상 URL 5종, 비정상 URL 5종.
2. 카드 생성 플로우
- 유효 URL 입력 시 카드 생성 + localStorage 저장.
- 중복 입력 시 생성 차단.
3. 페이지네이션
- 12개까지 1페이지, 13개부터 2페이지.
- 삭제 시 페이지 보정 동작 확인.
4. 모달/메모
- 카드 클릭 시 모달 오픈.
- 메모 입력 후 즉시 렌더 + 새로고침 후 유지.
5. API 에러 처리
- 404, 403, 네트워크 오류, README 없는 저장소.
6. 반응형/레이아웃
- 데스크톱 4열 고정 확인.
- 모바일 열 감소 및 사용성 확인.

### 구현 단계(작업 순서)
1. Vite React TS 프로젝트 초기화 및 폴더 구조 확정.
2. 도메인 타입/스토리지 유틸/URL 파서 구현.
3. GitHub API 클라이언트 + 요약 생성기 구현.
4. 입력 바 + 카드 그리드 + 카드 컴포넌트 구현.
5. 페이지네이션 컴포넌트 구현.
6. 상세 모달 + 메모 입력/리스트 구현.
7. 삭제/중복/오류 상태 UX 마감.
8. 테스트 작성(단위 + 통합) 및 수동 시나리오 검증.

### 명시적 가정/기본값
1. 레포가 비어 있으므로 신규 웹 앱을 `React + Vite + TypeScript`로 시작한다.
2. 저장소 목록 정렬은 인기도가 아니라 사용자 선택대로 `입력 순서 유지`를 적용한다.
3. 상세 팝업은 “핵심 메타 중심”으로 제한하고, 커밋/릴리즈/기여자까지는 포함하지 않는다.
4. 백엔드는 만들지 않고, 영속화는 브라우저 localStorage만 사용한다.
5. GitHub 토큰은 필수가 아니며, 있으면 자동 활용하는 옵션 설계로 간다.
