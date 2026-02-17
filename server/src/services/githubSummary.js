const DEFAULT_GLM_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
const DEFAULT_GLM_MODEL = 'glm-4.7'

const parseBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }

  if (normalized === 'false') {
    return false
  }

  return fallback
}

const toIso = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }

  return date.toISOString()
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeSummaryText = (value) => {
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

const buildGithubSummaryPrompt = (metadata) => {
  const fullName = String(metadata?.fullName || '').trim()
  const description = String(metadata?.description || '').trim()
  const readme = String(metadata?.readme || '').trim()

  return [
    '아래 GitHub 저장소 정보를 바탕으로 한국어 요약을 작성해 주세요.',
    '요구사항:',
    '1) 정확히 3문장',
    '2) 핵심 기능/대상 사용자/활용 포인트를 포함',
    '3) 전체 길이 220자 이내',
    '4) 불필요한 서두, 마크다운, 이모지 없이 평문으로 작성',
    '',
    `저장소: ${fullName}`,
    `설명: ${description}`,
    `README: ${readme}`,
  ].join('\n')
}

const summarizeGithubWithGlm = async (metadata, options = {}) => {
  const apiKey = String(options.apiKey || process.env.GLM_API_KEY || '').trim()
  const baseUrl = String(options.baseUrl || process.env.GLM_BASE_URL || DEFAULT_GLM_BASE_URL)
    .trim()
    .replace(/\/+$/, '')
  const model = String(options.model || process.env.GLM_MODEL || DEFAULT_GLM_MODEL).trim()
  const timeoutMs = Number(options.timeoutMs || 30_000)

  if (!apiKey) {
    throw new Error('GLM_API_KEY가 설정되지 않았습니다.')
  }

  const prompt = buildGithubSummaryPrompt(metadata)
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
            content: 'You summarize GitHub repositories in Korean for developer productivity dashboards.',
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
  const summary = normalizeSummaryText(rawText)

  if (!summary) {
    throw new Error('GLM 요약 응답이 비어 있습니다.')
  }

  return summary
}

export const resolveGithubSummaryConfig = (env = process.env) => {
  const timeoutSeconds = Number(env.GITHUB_SUMMARY_TIMEOUT_SECONDS || 30)
  const timeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? Math.floor(timeoutSeconds * 1000) : 30_000

  return {
    summaryEnabled: parseBoolean(env.GITHUB_SUMMARY_ENABLED, true),
    summaryProvider: String(env.GITHUB_SUMMARY_PROVIDER || 'glm').trim().toLowerCase(),
    timeoutMs,
    glm: {
      apiKey: String(env.GLM_API_KEY || '').trim(),
      baseUrl: String(env.GLM_BASE_URL || '').trim(),
      model: String(env.GLM_MODEL || '').trim(),
    },
  }
}

export const generateGithubSummaryState = async ({
  metadata,
  currentCard,
  force = false,
  config = resolveGithubSummaryConfig(),
}) => {
  const now = toIso(new Date())
  const preservedSummary = normalizeSummaryText(currentCard?.summary || '')
  const preservedStatus = currentCard?.summaryStatus || (preservedSummary ? 'ready' : 'idle')
  const preservedProvider = currentCard?.summaryProvider || (preservedSummary ? 'none' : 'none')

  if (!config.summaryEnabled) {
    return {
      summaryText: preservedSummary,
      summaryStatus: preservedStatus,
      summaryUpdatedAt: currentCard?.summaryUpdatedAt ? toIso(currentCard.summaryUpdatedAt) : null,
      summaryProvider: preservedProvider,
      summaryError: currentCard?.summaryError || null,
    }
  }

  if (!force && preservedSummary && preservedStatus === 'ready') {
    return {
      summaryText: preservedSummary,
      summaryStatus: 'ready',
      summaryUpdatedAt: currentCard?.summaryUpdatedAt ? toIso(currentCard.summaryUpdatedAt) : now,
      summaryProvider: preservedProvider === 'none' ? 'glm' : preservedProvider,
      summaryError: null,
    }
  }

  if (config.summaryProvider !== 'glm') {
    return {
      summaryText: preservedSummary,
      summaryStatus: 'failed',
      summaryUpdatedAt: now,
      summaryProvider: 'none',
      summaryError: `지원하지 않는 요약 제공자입니다: ${config.summaryProvider}`,
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const summaryText = await summarizeGithubWithGlm(metadata, {
        apiKey: config.glm.apiKey,
        baseUrl: config.glm.baseUrl,
        model: config.glm.model,
        timeoutMs: config.timeoutMs,
      })

      return {
        summaryText,
        summaryStatus: 'ready',
        summaryUpdatedAt: now,
        summaryProvider: 'glm',
        summaryError: null,
      }
    } catch (error) {
      if (attempt === 0) {
        await wait(500)
        continue
      }

      return {
        summaryText: preservedSummary,
        summaryStatus: 'failed',
        summaryUpdatedAt: now,
        summaryProvider: 'glm',
        summaryError: error instanceof Error ? error.message : '요약 생성에 실패했습니다.',
      }
    }
  }

  return {
    summaryText: preservedSummary,
    summaryStatus: 'failed',
    summaryUpdatedAt: now,
    summaryProvider: 'glm',
    summaryError: '요약 생성에 실패했습니다.',
  }
}
