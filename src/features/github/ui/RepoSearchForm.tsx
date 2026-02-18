type RepoSearchFormProps = {
  value: string
  onChange: (value: string) => void
}

export const RepoSearchForm = ({ value, onChange }: RepoSearchFormProps) => {
  return (
    <form className="repo-input-form repo-search-form" onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="repo-local-search" className="repo-input-label">
        등록 카드 검색
      </label>
      <div className="repo-input-controls">
        <input
          id="repo-local-search"
          name="repoLocalSearch"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="예: react, facebook, next.js"
          autoComplete="off"
          aria-label="등록 카드 검색"
        />
        {value.trim().length > 0 ? (
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => onChange('')}
            aria-label="등록 카드 검색 초기화"
          >
            X
          </button>
        ) : null}
      </div>
    </form>
  )
}
