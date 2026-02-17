const DEFAULT_GLM_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
const DEFAULT_GLM_MODEL = 'glm-4.7'

const sanitizeSummaryText = (value) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return ''
  }

  if (normalized.length <= 220) {
    return normalized
  }

  return `${normalized.slice(0, 217)}...`
}

const readGlmContent = (payload) => {
  const content = payload?.choices?.[0]?.message?.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => (entry && typeof entry === 'object' ? String(entry.text || '') : ''))
      .join('\n')
  }

  return ''
}

const buildYoutubeSummaryPrompt = (metadata) => {
  const title = String(metadata?.title || '').trim()
  const channelTitle = String(metadata?.channelTitle || '').trim()
  const description = String(metadata?.description || '').trim()
  const publishedAt = String(metadata?.publishedAt || '').trim()
  const viewCount = Number.isFinite(Number(metadata?.viewCount)) ? Number(metadata.viewCount) : 0

  return [
    '아래 YouTube 영상 정보를 바탕으로 한국어 요약을 작성해 주세요.',
    '요구사항:',
    '1) 정확히 3문장',
    '2) 핵심 내용/대상 사용자/활용 포인트를 포함',
    '3) 전체 길이 220자 이내',
    '4) 불필요한 서두나 마크다운, 이모지 없이 평문으로 작성',
    '',
    `제목: ${title}`,
    `채널: ${channelTitle}`,
    `게시일: ${publishedAt}`,
    `조회수: ${viewCount}`,
    `설명: ${description}`,
  ].join('\n')
}

const fetchWithTimeout = async (url, init, timeoutMs) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export const summarizeYoutubeWithGlm = async (metadata, options = {}) => {
  const apiKey = String(options.apiKey || process.env.GLM_API_KEY || '').trim()
  const baseUrl = String(options.baseUrl || process.env.GLM_BASE_URL || DEFAULT_GLM_BASE_URL)
    .trim()
    .replace(/\/+$/, '')
  const model = String(options.model || process.env.GLM_MODEL || DEFAULT_GLM_MODEL).trim()
  const timeoutMs = Number(options.timeoutMs || 30_000)

  if (!apiKey) {
    throw new Error('GLM_API_KEY가 설정되지 않았습니다.')
  }

  const prompt = buildYoutubeSummaryPrompt(metadata)
  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'You summarize YouTube videos in Korean for developer productivity dashboards.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    },
    timeoutMs,
  )

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const remoteMessage =
      payload?.error?.message || payload?.message || `GLM 요약 요청이 실패했습니다. (HTTP ${response.status})`
    throw new Error(String(remoteMessage))
  }

  const payload = await response.json().catch(() => ({}))
  const rawText = readGlmContent(payload)
  const summary = sanitizeSummaryText(rawText)

  if (!summary) {
    throw new Error('GLM 요약 응답이 비어 있습니다.')
  }

  return summary
}
