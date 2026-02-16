## 카테고리/창고 이동 기능 확장 계획 (메인-창고-사용자 카테고리)

### 요약
현재 단일 카드 목록 구조를 `카테고리 기반 보드`로 확장한다.  
기본 카테고리 `메인`, `창고`를 항상 제공하고, 사용자 생성 카테고리를 상단 탭으로 관리한다.  
카드 헤더에서 `삭제 왼쪽 이동 버튼(드롭다운 아이콘 1개)`으로 창고/카테고리 이동을 수행한다.  
저장소 추가는 `메인`에서만 가능하며, 상세/삭제/메모는 모든 카테고리에서 동일하게 동작한다.

## 확정된 요구사항 반영
1. 카드 소속: `한 카드 = 한 카테고리`
2. 기본 카테고리: `메인 + 창고` 자동 생성
3. 상단 끝 `세팅 메뉴`: `생성 + 이름변경 + 삭제` 지원
4. 기본 카테고리 정책: `이름변경 가능`, `삭제 불가`
5. 카드 이동 UI: `삭제 왼쪽 드롭다운 아이콘 1개`
6. 카테고리 삭제 시 카드 처리: 자동으로 `창고`로 이동
7. 저장소 추가: `메인 화면에서만 입력창 표시`
8. 카드 이동 시 위치: 대상 카테고리에서 `맨 위`

## 공개 인터페이스/타입 변경
### 1) 타입 확장 (`src/types.ts`)
- `GitHubRepoCard`에 `categoryId: string` 추가
- 신규 타입
```ts
type Category = {
  id: string
  name: string
  isSystem: boolean
  createdAt: string
}

type CategoryId = 'main' | 'warehouse' | string
```

### 2) 스토리지 키 추가 (`src/constants.ts`, `src/storage/localStorage.ts`)
- `CATEGORIES_STORAGE_KEY = 'github_categories_v1'`
- 필요 시 선택 카테고리 저장: `SELECTED_CATEGORY_STORAGE_KEY = 'github_selected_category_v1'`

### 3) 상태 모델 확장 (`src/state/dashboardReducer.ts`)
- `DashboardState`에:
  - `categories: Category[]`
  - `selectedCategoryId: string`
- 액션 추가:
  - `selectCategory`
  - `createCategory`
  - `renameCategory`
  - `deleteCategory`
  - `moveCardToCategory`
  - `hydrateCategories` (초기 로드/마이그레이션)

## 데이터/마이그레이션 설계
1. 기존 카드 데이터는 초기 로드 시 `categoryId`가 없으면 자동으로 `main` 할당
2. 카테고리 저장값이 없으면 기본 2개 생성:
   - `{ id: 'main', name: '메인', isSystem: true }`
   - `{ id: 'warehouse', name: '창고', isSystem: true }`
3. 카테고리 삭제 시:
   - 삭제 대상 카드 전부 `warehouse`로 이동
   - 이동된 카드들은 창고 목록 맨 위로 오도록 재배치
4. 카테고리 이름 중복은 대소문자 무시 기준으로 차단

## UI/UX 상세 설계
### 1) 상단 카테고리 바 (`src/components` 신규)
- 탭 순서: `메인`, `창고`, 사용자 생성 카테고리(생성순)
- 탭 끝에 `세팅(⚙)` 메뉴 배치
- 현재 선택 카테고리 하이라이트
- 카테고리 전환 시 현재 페이지는 1로 리셋

### 2) 세팅 메뉴 기능
- 카테고리 생성
- 카테고리 이름변경
- 카테고리 삭제
- 제약:
  - `main`, `warehouse`는 삭제 버튼 비활성
  - `main`, `warehouse`는 이름변경 가능

### 3) 메인 화면 전용 추가 정책
- `selectedCategoryId === 'main'`일 때만 `RepoInputForm` 렌더
- 다른 카테고리에서는 안내 문구 표시:
  - 예: “저장소 추가는 메인에서만 가능합니다.”

### 4) 카드 액션 변경 (`src/components/RepoCard.tsx`)
- 헤더 우측: `[이동 드롭다운 아이콘] [삭제]`
- 이동 메뉴 항목:
  - 창고
  - 사용자 생성 카테고리 목록
- 현재 소속 카테고리 항목은 비활성 처리
- 이동 완료 시 토스트/메시지 없이 즉시 반영(필요 시 aria-live)

## 동작 규칙
1. 리스트/페이지네이션은 `선택된 카테고리 카드만` 대상으로 계산
2. 카드 이동 시:
   - 카드의 `categoryId` 변경
   - 대상 카테고리의 필터 결과에서 맨 위 배치
3. 카드 삭제 시:
   - 기존 로직 유지 + 상세 캐시 삭제
4. 카테고리 삭제 시:
   - 해당 카테고리 카드 전부 창고로 이동 후 카테고리 삭제
   - 삭제 중이던 카테고리가 현재 선택이면 `main`으로 자동 전환

## 구현 파일 단위 계획
1. `src/types.ts`  
- Category 관련 타입 추가, `GitHubRepoCard.categoryId` 추가
2. `src/constants.ts`  
- 카테고리 스토리지 키 상수 추가
3. `src/storage/localStorage.ts`  
- categories load/save 함수 추가
4. `src/state/dashboardReducer.ts`  
- 카테고리 상태/액션/이동/삭제 재배치 로직 추가
- 기존 데이터 마이그레이션 함수 포함
5. `src/App.tsx`  
- 상단 카테고리 바 + 세팅 메뉴 연결
- 메인에서만 입력폼 노출
- category 필터 기반 카드 목록/페이지네이션 처리
- RepoCard에 이동 핸들러/카테고리 목록 전달
6. `src/components/RepoCard.tsx`  
- 이동 드롭다운 아이콘 버튼 + 메뉴 UI 추가
7. `src/App.css`  
- 카테고리 바, 세팅 메뉴, 이동 메뉴 스타일 추가

## 테스트 시나리오
### 단위 테스트
1. 초기 마이그레이션:
- 기존 카드(categoryId 없음) -> `main` 할당
2. 카테고리 CRUD:
- 생성/이름변경/삭제(기본 카테고리 삭제 불가)
3. 카드 이동:
- 대상 카테고리에서 맨 위 배치
4. 카테고리 삭제 재배치:
- 카드 자동 창고 이동

### 통합 테스트 (`src/App.test.tsx`)
1. `메인`에서만 추가 입력창 보임
2. 카테고리 전환 시 카드 필터링 정상
3. 카드 이동 메뉴로 창고/사용자 카테고리 이동 가능
4. 카테고리 삭제 시 카드가 창고로 이동
5. 페이지네이션이 카테고리별로 독립 계산됨

## 엣지 케이스/예외 처리
1. 같은 이름 카테고리 생성/변경 시 에러
2. 빈 이름/공백 이름 금지
3. 현재 선택 카테고리 삭제 시 `main`으로 안전 전환
4. 이동 메뉴에서 현재 카테고리 선택 불가
5. 로컬스토리지 데이터 손상 시 안전 기본값 복구

## 명시적 가정/기본값
1. 기본 카테고리 ID는 고정: `main`, `warehouse`
2. 카테고리 이름은 중복 불가(대소문자 무시), 길이 제한 1~30자
3. 사용자 카테고리 개수 제한은 두지 않음(향후 필요 시 상한 추가)
4. 저장소 추가 진입점은 메인 1곳으로 고정
5. 이동은 “복사”가 아닌 “소속 변경(단일 소속)”으로 처리
