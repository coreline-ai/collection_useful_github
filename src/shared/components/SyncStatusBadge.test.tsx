import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SyncStatusBadge } from './SyncStatusBadge'

describe('SyncStatusBadge', () => {
  it('renders healthy label', () => {
    render(<SyncStatusBadge status="healthy" />)
    expect(screen.getByText('연결 정상')).toBeInTheDocument()
    expect(screen.getByText(/마지막 성공:/)).toBeInTheDocument()
    expect(screen.getByText(/--:--:--/)).toBeInTheDocument()
  })

  it('renders retrying label', () => {
    render(<SyncStatusBadge status="retrying" />)
    expect(screen.getByText('재시도 중')).toBeInTheDocument()
  })

  it('renders local label', () => {
    render(<SyncStatusBadge status="local" />)
    expect(screen.getByText('로컬 전환')).toBeInTheDocument()
  })

  it('renders recovered label', () => {
    render(<SyncStatusBadge status="recovered" />)
    expect(screen.getByText('복구 완료')).toBeInTheDocument()
  })

  it('renders formatted last success time when provided', () => {
    render(<SyncStatusBadge status="healthy" lastSuccessAt="2026-02-16T08:41:12.000Z" />)
    expect(screen.getByText(/마지막 성공:/)).toBeInTheDocument()
    expect(screen.queryByText('--:--:--')).not.toBeInTheDocument()
  })
})
