import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TopSectionNav } from './TopSectionNav'

describe('TopSectionNav', () => {
  it('renders 4 tabs and marks active section', () => {
    render(<TopSectionNav activeSection="youtube" onChangeSection={vi.fn()} />)

    expect(screen.getByRole('tab', { name: '통합검색' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: '깃허브' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: '유튜브' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '북마크' })).toHaveAttribute('aria-selected', 'false')
  })

  it('emits selected section when a tab is clicked', () => {
    const onChangeSection = vi.fn()

    render(<TopSectionNav activeSection="github" onChangeSection={onChangeSection} />)

    fireEvent.click(screen.getByRole('tab', { name: '북마크' }))
    expect(onChangeSection).toHaveBeenCalledWith('bookmark')
  })
})
