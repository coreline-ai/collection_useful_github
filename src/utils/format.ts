export const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)

export const formatDate = (isoDate: string): string =>
  new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(isoDate))

export const formatDateTime = (isoDate: string): string =>
  new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoDate))
