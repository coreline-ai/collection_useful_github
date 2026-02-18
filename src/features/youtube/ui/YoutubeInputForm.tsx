import { useState } from 'react'
import type { FormEvent } from 'react'

type YoutubeInputFormProps = {
  onSubmit: (value: string) => Promise<boolean>
  loading: boolean
  errorMessage: string | null
}

export const YoutubeInputForm = ({ onSubmit, loading, errorMessage }: YoutubeInputFormProps) => {
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
      <label htmlFor="youtube-video-url" className="repo-input-label">
        YouTube 영상 URL
      </label>
      <div className="repo-input-controls">
        <input
          id="youtube-video-url"
          name="youtubeVideoUrl"
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="예: https://www.youtube.com/watch?v=dQw4w9WgXcQ"
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
