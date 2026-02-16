import type { FormEvent } from 'react'

type RepoSearchFormProps = {
  value: string
  loading: boolean
  errorMessage: string | null
  onChange: (value: string) => void
  onSubmit: () => Promise<void>
}

export const RepoSearchForm = ({ value, loading, errorMessage, onChange, onSubmit }: RepoSearchFormProps) => {
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit()
  }

  return (
    <form className="repo-input-form repo-search-form" onSubmit={handleSubmit}>
      <label htmlFor="repo-public-search" className="repo-input-label">
        GitHub 공개 저장소 검색
      </label>
      <div className="repo-input-controls">
        <input
          id="repo-public-search"
          name="repoPublicSearch"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="예: react, nextjs, vercel"
          autoComplete="off"
          disabled={loading}
        />
        <button type="submit" disabled={loading}>
          {loading ? '검색 중...' : '검색'}
        </button>
      </div>
      {errorMessage ? <p className="inline-error">{errorMessage}</p> : null}
    </form>
  )
}
