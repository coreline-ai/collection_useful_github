import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GitHubRepoCard } from '@shared/types'
import { RepoCard } from './RepoCard'

const baseRepo: GitHubRepoCard = {
  id: 'facebook/react',
  categoryId: 'main',
  owner: 'facebook',
  repo: 'react',
  fullName: 'facebook/react',
  description: 'React repository',
  summary:
    'React는 사용자 인터페이스를 만들기 위한 라이브러리이며 컴포넌트 기반 구조와 선언형 렌더링을 제공합니다.',
  htmlUrl: 'https://github.com/facebook/react',
  homepage: null,
  language: 'TypeScript',
  stars: 1,
  forks: 1,
  watchers: 1,
  openIssues: 1,
  topics: [],
  license: null,
  defaultBranch: 'main',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  addedAt: '2026-01-01T00:00:00.000Z',
  summaryStatus: 'ready',
  summaryProvider: 'none',
  summaryUpdatedAt: null,
  summaryError: null,
}

describe('RepoCard', () => {
  it('renders full summary in tooltip for hover/focus', () => {
    render(
      <RepoCard
        repo={baseRepo}
        categories={[{ id: 'main', name: '메인', isSystem: true, createdAt: '2026-01-01T00:00:00.000Z' }]}
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRegenerateSummary={vi.fn()}
      />,
    )

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent(baseRepo.summary)
    expect(screen.getAllByText(baseRepo.summary)).toHaveLength(2)
  })
})
