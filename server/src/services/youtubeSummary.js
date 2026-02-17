import { summarizeYoutubeWithGlm } from './glmSummary.js'
import { ensureYoutubeNotebookSource, resolveNotebookLmConfig } from './notebooklm.js'

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

export const resolveYoutubeSummaryConfig = (env = process.env) => {
  const timeoutSeconds = Number(env.YOUTUBE_SUMMARY_TIMEOUT_SECONDS || 30)
  const timeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? Math.floor(timeoutSeconds * 1000) : 30_000

  return {
    summaryEnabled: parseBoolean(env.YOUTUBE_SUMMARY_ENABLED, true),
    summaryProvider: String(env.YOUTUBE_SUMMARY_PROVIDER || 'glm').trim().toLowerCase(),
    timeoutMs,
    notebook: resolveNotebookLmConfig(env),
    glm: {
      apiKey: String(env.GLM_API_KEY || '').trim(),
      baseUrl: String(env.GLM_BASE_URL || '').trim(),
      model: String(env.GLM_MODEL || '').trim(),
    },
  }
}

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

const buildReadyResult = (summaryText, now, notebook) => {
  return {
    summaryText: normalizeSummaryText(summaryText),
    summaryStatus: 'ready',
    summaryUpdatedAt: now,
    summaryProvider: 'glm',
    summaryError: null,
    notebookSourceStatus: notebook.notebookSourceStatus,
    notebookSourceId: notebook.notebookSourceId,
    notebookId: notebook.notebookId,
  }
}

export const generateYoutubeSummaryState = async ({
  videoId,
  metadata,
  currentCard,
  force = false,
  config = resolveYoutubeSummaryConfig(),
}) => {
  const notebookResult = await ensureYoutubeNotebookSource({ videoId, videoUrl: metadata?.url }, config.notebook)
  const now = toIso(new Date())
  const preservedSummary = normalizeSummaryText(currentCard?.summaryText || '')
  const preservedStatus = currentCard?.summaryStatus || (preservedSummary ? 'ready' : 'idle')
  const preservedProvider = currentCard?.summaryProvider || (preservedSummary ? 'glm' : 'none')

  if (!config.summaryEnabled) {
    return {
      summaryText: preservedSummary,
      summaryStatus: preservedStatus,
      summaryUpdatedAt: currentCard?.summaryUpdatedAt ? toIso(currentCard.summaryUpdatedAt) : null,
      summaryProvider: preservedProvider,
      summaryError: currentCard?.summaryError || null,
      notebookSourceStatus: notebookResult.notebookSourceStatus,
      notebookSourceId: notebookResult.notebookSourceId,
      notebookId: notebookResult.notebookId,
    }
  }

  if (!force && preservedSummary && preservedStatus === 'ready') {
    return {
      summaryText: preservedSummary,
      summaryStatus: 'ready',
      summaryUpdatedAt: currentCard?.summaryUpdatedAt ? toIso(currentCard.summaryUpdatedAt) : now,
      summaryProvider: preservedProvider === 'none' ? 'glm' : preservedProvider,
      summaryError: null,
      notebookSourceStatus: notebookResult.notebookSourceStatus,
      notebookSourceId: notebookResult.notebookSourceId,
      notebookId: notebookResult.notebookId,
    }
  }

  if (config.summaryProvider !== 'glm') {
    return {
      summaryText: preservedSummary,
      summaryStatus: 'failed',
      summaryUpdatedAt: now,
      summaryProvider: 'none',
      summaryError: `지원하지 않는 요약 제공자입니다: ${config.summaryProvider}`,
      notebookSourceStatus: notebookResult.notebookSourceStatus,
      notebookSourceId: notebookResult.notebookSourceId,
      notebookId: notebookResult.notebookId,
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const summaryText = await summarizeYoutubeWithGlm(
        {
          title: metadata?.title || '',
          channelTitle: metadata?.channelTitle || '',
          description: metadata?.description || '',
          publishedAt: metadata?.publishedAt || '',
          viewCount: metadata?.viewCount || 0,
        },
        {
          apiKey: config.glm.apiKey,
          baseUrl: config.glm.baseUrl,
          model: config.glm.model,
          timeoutMs: config.timeoutMs,
        },
      )

      return buildReadyResult(summaryText, now, notebookResult)
    } catch (error) {
      if (attempt === 0) {
        await wait(500)
        continue
      }

      return {
        summaryText: '',
        summaryStatus: 'failed',
        summaryUpdatedAt: now,
        summaryProvider: 'glm',
        summaryError: error instanceof Error ? error.message : '요약 생성에 실패했습니다.',
        notebookSourceStatus: notebookResult.notebookSourceStatus,
        notebookSourceId: notebookResult.notebookSourceId,
        notebookId: notebookResult.notebookId,
      }
    }
  }

  return {
    summaryText: '',
    summaryStatus: 'failed',
    summaryUpdatedAt: now,
    summaryProvider: 'glm',
    summaryError: '요약 생성에 실패했습니다.',
    notebookSourceStatus: notebookResult.notebookSourceStatus,
    notebookSourceId: notebookResult.notebookSourceId,
    notebookId: notebookResult.notebookId,
  }
}
