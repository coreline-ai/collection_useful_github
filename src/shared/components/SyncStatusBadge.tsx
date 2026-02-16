import type { SyncConnectionStatus } from '@shared/types'

type SyncStatusBadgeProps = {
  status: SyncConnectionStatus
  lastSuccessAt?: string | null
}

const STATUS_LABEL: Record<SyncConnectionStatus, string> = {
  healthy: '연결 정상',
  retrying: '재시도 중',
  local: '로컬 전환',
  recovered: '복구 완료',
}

const formatLastSuccessTime = (value: string | null | undefined): string => {
  if (!value) {
    return '--:--:--'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--:--:--'
  }

  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

const formatTooltipDate = (value: string | null | undefined): string => {
  if (!value) {
    return '--'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  const twoDigit = (target: number) => String(target).padStart(2, '0')
  const year = date.getFullYear()
  const month = twoDigit(date.getMonth() + 1)
  const day = twoDigit(date.getDate())
  const hour = twoDigit(date.getHours())
  const minute = twoDigit(date.getMinutes())
  const second = twoDigit(date.getSeconds())

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

export const SyncStatusBadge = ({ status, lastSuccessAt }: SyncStatusBadgeProps) => {
  const formattedTime = formatLastSuccessTime(lastSuccessAt)
  const tooltipDate = formatTooltipDate(lastSuccessAt)

  return (
    <p className={`sync-status-badge sync-status-${status}`} role="status" aria-live="polite">
      <span className="sync-status-dot" aria-hidden="true" />
      <span>{STATUS_LABEL[status]}</span>
      <span className="sync-status-time" title={`마지막 성공: ${tooltipDate}`}>
        마지막 성공: {formattedTime}
      </span>
    </p>
  )
}
