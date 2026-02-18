type BookmarkSearchFormProps = {
  value: string
  onChange: (value: string) => void
}

export const BookmarkSearchForm = ({ value, onChange }: BookmarkSearchFormProps) => {
  return (
    <form className="repo-input-form repo-search-form" onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="bookmark-local-search" className="repo-input-label">
        등록 카드 검색
      </label>
      <div className="repo-input-controls">
        <input
          id="bookmark-local-search"
          name="bookmarkLocalSearch"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="예: openai, ai, docs"
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
