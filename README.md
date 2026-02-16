# GitHub Card Dashboard

GitHub 저장소 URL을 입력하면 카드형 대시보드로 저장소 메타/요약/인기도를 확인하고, 상세 팝업에서 개인 메모를 남길 수 있는 React + Vite 앱입니다.

## 기능

- GitHub URL 또는 `owner/repo` 입력으로 카드 생성
- 카드 그리드(데스크톱 4열), 페이지당 12개 + 숫자 페이지네이션
- 카드 클릭 시 상세 팝업 (Overview/README/Activity 탭, README는 sanitize된 Markdown 렌더)
- 상세 팝업 하단 메모 입력/기록
- 카드 삭제 (연결 메모 동시 삭제)
- `localStorage` 영속화
- 메모 입력 최대 길이: 500자
- 상세 팝업의 `개요 / README / Activity` 탭에서 수동 번역 버튼으로 한글 번역
- 상세 데이터 캐시: 최초 1회 조회 후 캐시 사용, `업데이트 확인`으로 최신 커밋 비교 후 필요할 때만 갱신

## 실행

```bash
npm install
npm run dev
```

## 테스트

```bash
npm run test
npm run test:coverage
```

## 환경 변수 (선택)

`.env` 파일에 설정하면 GitHub API rate limit 완화에 도움이 됩니다.

```bash
VITE_GITHUB_TOKEN=your_token
VITE_GITHUB_TIMEOUT_SECONDS=12
GLM_API_KEY=your_glm_key
GLM_BASE_URL=https://api.z.ai/api/coding/paas/v4
GLM_MODEL=glm-4.7
GLM_TIMEOUT_SECONDS=30

# optional fallback
VITE_OPENAI_API_KEY=your_openai_key
VITE_OPENAI_MODEL=gpt-4.1-mini
VITE_OPENAI_TIMEOUT_SECONDS=30
```

우선순위는 `GLM_*` 설정이 있으면 GLM 번역을 사용하고, 없으면 OpenAI를 사용합니다.
자동 번역은 수행하지 않으며, 각 탭의 `번역` 버튼 클릭 시에만 번역 API를 호출합니다.
