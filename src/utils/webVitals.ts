import { TOP_SECTION_STORAGE_KEY } from '@constants'

type WebVitalRating = 'good' | 'needs-improvement' | 'poor'

type WebVitalPayload = {
  name: string
  value: number
  rating: WebVitalRating
  id: string
  navigationType: string
  provider: string | null
  type: 'web-vitals'
  page: string
}

const isEnabled = (): boolean => {
  const raw = String(import.meta.env.VITE_WEB_VITALS_ENABLED || '').trim().toLowerCase()
  return raw === 'true'
}

const getEndpoint = (): string => {
  return String(import.meta.env.VITE_WEB_VITALS_ENDPOINT || '').trim()
}

const getActiveProvider = (): string | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const value = window.localStorage.getItem(TOP_SECTION_STORAGE_KEY)
  if (value === 'github' || value === 'youtube' || value === 'bookmark' || value === 'search') {
    return value
  }

  return null
}

const sendMetric = (payload: WebVitalPayload) => {
  const endpoint = getEndpoint()
  if (!endpoint) {
    return
  }

  const body = JSON.stringify(payload)

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' })
    navigator.sendBeacon(endpoint, blob)
    return
  }

  void fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    keepalive: true,
  })
}

export const reportWebVitals = async (): Promise<void> => {
  if (!isEnabled()) {
    return
  }

  const webVitals = await import('web-vitals')
  const onMetric = (metric: {
    name: string
    value: number
    rating: WebVitalRating
    id: string
    navigationType: string
  }) => {
    sendMetric({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      id: metric.id,
      navigationType: metric.navigationType,
      provider: getActiveProvider(),
      type: 'web-vitals',
      page: typeof window !== 'undefined' ? window.location.pathname : '/',
    })
  }

  webVitals.onCLS(onMetric)
  webVitals.onFCP(onMetric)
  webVitals.onINP(onMetric)
  webVitals.onLCP(onMetric)
  webVitals.onTTFB(onMetric)
}

