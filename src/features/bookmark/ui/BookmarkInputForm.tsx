import { useState } from 'react'
import type { FormEvent } from 'react'

type BookmarkInputFormProps = {
  onSubmit: (value: string) => Promise<boolean>
  loading: boolean
  errorMessage: string | null
}

export const BookmarkInputForm = ({ onSubmit, loading, errorMessage }: BookmarkInputFormProps) => {
  const [inputValue, setInputValue] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const success = await onSubmit(inputValue)
    if (success) {
      setInputValue('')
    }
  }

  return (
    <form className="repo-input-form" onSubmit={handleSubmit}>
      <label htmlFor="bookmark-url-input" className="repo-input-label">
        북마크 URL
      </label>
      <div className="repo-input-controls">
        <input
          id="bookmark-url-input"
          name="bookmarkUrl"
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="예: https://example.com/article"
          disabled={loading}
          autoComplete="off"
          required
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? '조회 중...' : '추가'}
        </button>
      </div>
      {errorMessage ? <p className="inline-error">{errorMessage}</p> : null}
    </form>
  )
}
