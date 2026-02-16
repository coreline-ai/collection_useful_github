export const isTransientRemoteSyncError = (error: unknown): boolean => {
  if (error instanceof TypeError) {
    return true
  }

  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('cors') ||
    message.includes('timeout') ||
    message.includes('abort')
  )
}

export const isRemoteSyncConnectionWarning = (message: string | null | undefined): boolean => {
  if (!message) {
    return false
  }

  return (
    message.startsWith('원격 저장 연결이 불안정합니다.') ||
    message.includes('로컬 저장으로 전환했습니다.') ||
    message.includes('원격 저장 연결이 계속 실패해')
  )
}
