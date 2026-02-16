import { describe, expect, it } from 'vitest'
import { isRemoteSyncConnectionWarning, isTransientRemoteSyncError } from './remoteSync'

describe('isTransientRemoteSyncError', () => {
  it('treats TypeError as transient network error', () => {
    expect(isTransientRemoteSyncError(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('detects transient keywords in message', () => {
    expect(isTransientRemoteSyncError(new Error('CORS blocked'))).toBe(true)
    expect(isTransientRemoteSyncError(new Error('Network timeout while saving'))).toBe(true)
  })

  it('does not mark domain validation errors as transient', () => {
    expect(isTransientRemoteSyncError(new Error('유효하지 않은 요청입니다.'))).toBe(false)
  })
})

describe('isRemoteSyncConnectionWarning', () => {
  it('matches sync connection warnings', () => {
    expect(isRemoteSyncConnectionWarning('원격 저장 연결이 불안정합니다. 자동 재시도 중입니다. (1/3)')).toBe(true)
    expect(isRemoteSyncConnectionWarning('원격 저장 연결이 계속 실패해 로컬 저장으로 전환했습니다.')).toBe(true)
    expect(isRemoteSyncConnectionWarning('유튜브 대시보드 저장에 실패했습니다. 로컬 저장으로 전환했습니다.')).toBe(
      true,
    )
  })

  it('ignores unrelated messages', () => {
    expect(isRemoteSyncConnectionWarning('이미 추가된 영상입니다.')).toBe(false)
    expect(isRemoteSyncConnectionWarning(null)).toBe(false)
  })
})
