import { useState } from 'react'
import type { FormEvent } from 'react'

type RepoInputFormProps = {
  onSubmit: (value: string) => Promise<boolean>
  loading: boolean
  errorMessage: string | null
}

export const RepoInputForm = ({ onSubmit, loading, errorMessage }: RepoInputFormProps) => {
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
      <label htmlFor="repo-url" className="repo-input-label">
        GitHub 저장소 URL
      </label>
      <div className="repo-input-controls">
        <input
          id="repo-url"
          name="repoUrl"
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="예: https://github.com/facebook/react 또는 facebook/react"
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
