import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SectionPlaceholder } from './SectionPlaceholder'

describe('SectionPlaceholder', () => {
  it('shows youtube placeholder text', () => {
    render(<SectionPlaceholder section="youtube" />)

    expect(screen.getByRole('heading', { level: 2, name: '유튜브' })).toBeInTheDocument()
    expect(screen.getByText('유튜브 기능은 준비중입니다.')).toBeInTheDocument()
  })

  it('shows bookmark placeholder text', () => {
    render(<SectionPlaceholder section="bookmark" />)

    expect(screen.getByRole('heading', { level: 2, name: '북마크' })).toBeInTheDocument()
    expect(screen.getByText('북마크 기능은 준비중입니다.')).toBeInTheDocument()
  })
})
