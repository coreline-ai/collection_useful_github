import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { GoogleAuth } from 'google-auth-library'
import { ensureYoutubeSourceViaCli } from './notebooklmCliAdapter.js'

const NOTEBOOKLM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

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

export const resolveNotebookLmConfig = (env = process.env) => {
  const location = String(env.NOTEBOOKLM_LOCATION || 'global').trim()

  return {
    enabled: parseBoolean(env.NOTEBOOKLM_ENABLED, false),
    client: String(env.NOTEBOOKLM_CLIENT || 'cli').trim().toLowerCase(),
    cliCommand: String(env.NOTEBOOKLM_CLI_COMMAND || 'nlm').trim(),
    cliTimeoutMs: Math.floor(Number(env.NOTEBOOKLM_CLI_TIMEOUT_SECONDS || 60) * 1000),
    projectId: String(env.NOTEBOOKLM_PROJECT_ID || '').trim(),
    location,
    endpointLocation: String(env.NOTEBOOKLM_ENDPOINT_LOCATION || location || 'global').trim() || 'global',
    notebookId: String(env.NOTEBOOKLM_NOTEBOOK_ID || '').trim(),
    serviceAccountJson: String(env.NOTEBOOKLM_SERVICE_ACCOUNT_JSON || '').trim(),
  }
}

const parseNotebookErrorMessage = (payload, fallback) => {
  const directMessage = typeof payload?.error?.message === 'string' ? payload.error.message : ''
  if (directMessage) {
    return directMessage
  }

  const fallbackMessage = typeof payload?.message === 'string' ? payload.message : ''
  if (fallbackMessage) {
    return fallbackMessage
  }

  return fallback
}

const toNotebookEndpointBase = (config) => {
  const endpointLocation = String(config.endpointLocation || config.location || 'global')
  return `https://${endpointLocation}-discoveryengine.googleapis.com/v1alpha`
}

const resolveYouTubeVideoUrl = ({ videoId, videoUrl }) => {
  if (typeof videoUrl === 'string' && videoUrl.trim()) {
    return videoUrl.trim()
  }

  const normalizedVideoId = String(videoId || '').trim()
  if (!normalizedVideoId) {
    return ''
  }

  return `https://www.youtube.com/watch?v=${normalizedVideoId}`
}

const parseServiceAccountCredentials = async (serviceAccountJson) => {
  const raw = String(serviceAccountJson || '').trim()
  if (!raw) {
    return null
  }

  if (raw.startsWith('{')) {
    return JSON.parse(raw)
  }

  try {
    await access(raw, fsConstants.F_OK | fsConstants.R_OK)
    const fileContents = await readFile(raw, 'utf8')
    return JSON.parse(fileContents)
  } catch {
    // continue to base64 parsing fallback
  }

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8')
    if (decoded.trim().startsWith('{')) {
      return JSON.parse(decoded)
    }
  } catch {
    // noop
  }

  throw new Error('NOTEBOOKLM_SERVICE_ACCOUNT_JSON 형식이 올바르지 않습니다.')
}

const getNotebookAuthHeaders = async (config) => {
  const credentials = await parseServiceAccountCredentials(config.serviceAccountJson)

  const auth = new GoogleAuth({
    scopes: [NOTEBOOKLM_SCOPE],
    ...(credentials ? { credentials } : {}),
  })
  const client = await auth.getClient()
  return client.getRequestHeaders()
}

const listNotebookSources = async ({ parent, config, authHeaders }) => {
  const sources = []
  let pageToken = ''
  const baseUrl = toNotebookEndpointBase(config)

  while (true) {
    const url = new URL(`${baseUrl}/${parent}/sources`)
    url.searchParams.set('pageSize', '100')
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        ...authHeaders,
      },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(parseNotebookErrorMessage(payload, `NotebookLM source 목록 조회 실패 (${response.status})`))
    }

    const chunk = Array.isArray(payload.sources) ? payload.sources : []
    sources.push(...chunk)

    pageToken = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : ''
    if (!pageToken) {
      break
    }
  }

  return sources
}

const extractSourceFromPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  if (Array.isArray(payload.sources) && payload.sources[0] && typeof payload.sources[0] === 'object') {
    return payload.sources[0]
  }

  const queue = [payload]
  const visited = new Set()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue
    }

    visited.add(current)

    if (typeof current.name === 'string' && current.name.includes('/sources/')) {
      return current
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          value.forEach((entry) => {
            if (entry && typeof entry === 'object') {
              queue.push(entry)
            }
          })
        } else {
          queue.push(value)
        }
      }
    }
  }

  return null
}

const createNotebookYoutubeSource = async ({ parent, config, authHeaders, videoUrl }) => {
  const baseUrl = toNotebookEndpointBase(config)
  const endpointUrl = `${baseUrl}/${parent}/sources:batchCreate`

  const runCreate = async (body) => {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const payload = await response.json().catch(() => ({}))
    return { response, payload }
  }

  const first = await runCreate({
    userContents: [
      {
        videoContent: {
          url: videoUrl,
        },
      },
    ],
  })

  if (first.response.ok) {
    return extractSourceFromPayload(first.payload)
  }

  const firstMessage = parseNotebookErrorMessage(first.payload, '')
  const shouldRetryWithYoutubeUrl =
    first.response.status === 400 &&
    (firstMessage.toLowerCase().includes('youtubeurl') || firstMessage.toLowerCase().includes('unknown name "url"'))

  if (!shouldRetryWithYoutubeUrl) {
    throw new Error(firstMessage || `NotebookLM source 생성 실패 (${first.response.status})`)
  }

  const second = await runCreate({
    userContents: [
      {
        videoContent: {
          youtubeUrl: videoUrl,
        },
      },
    ],
  })

  if (!second.response.ok) {
    const secondMessage = parseNotebookErrorMessage(second.payload, `NotebookLM source 생성 실패 (${second.response.status})`)
    throw new Error(secondMessage)
  }

  return extractSourceFromPayload(second.payload)
}

const extractSourceId = (source) => {
  const name = typeof source?.name === 'string' ? source.name : ''
  if (!name) {
    return null
  }

  const parts = name.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : null
}

const findMatchingYoutubeSource = ({ sources, videoId, videoUrl }) => {
  const normalizedVideoId = String(videoId || '').trim().toLowerCase()
  const normalizedVideoUrl = String(videoUrl || '').trim().toLowerCase()

  return (
    sources.find((source) => {
      const haystack = JSON.stringify(source).toLowerCase()
      if (normalizedVideoId && haystack.includes(normalizedVideoId)) {
        return true
      }

      if (normalizedVideoUrl && haystack.includes(normalizedVideoUrl)) {
        return true
      }

      return false
    }) || null
  )
}

export const ensureYoutubeNotebookSource = async ({ videoId, videoUrl }, config = resolveNotebookLmConfig()) => {
  if (!config.enabled) {
    return {
      notebookSourceStatus: 'disabled',
      notebookSourceId: null,
      notebookId: null,
      notebookError: null,
    }
  }

  if (!config.notebookId) {
    return {
      notebookSourceStatus: 'failed',
      notebookSourceId: null,
      notebookId: null,
      notebookError: 'NOTEBOOKLM_NOTEBOOK_ID가 설정되지 않았습니다.',
    }
  }

  if (!config.projectId) {
    return {
      notebookSourceStatus: 'failed',
      notebookSourceId: null,
      notebookId: null,
      notebookError: 'NOTEBOOKLM_PROJECT_ID가 설정되지 않았습니다.',
    }
  }

  const resolvedVideoUrl = resolveYouTubeVideoUrl({ videoId, videoUrl })
  if (!resolvedVideoUrl) {
    return {
      notebookSourceStatus: 'failed',
      notebookSourceId: null,
      notebookId: config.notebookId,
      notebookError: 'YouTube 영상 URL을 확인할 수 없습니다.',
    }
  }

  if (config.client === 'cli') {
    try {
      const cliResult = await ensureYoutubeSourceViaCli({
        videoId,
        videoUrl: resolvedVideoUrl,
        notebookId: config.notebookId,
        command: config.cliCommand || 'nlm',
        timeoutMs: Number.isFinite(Number(config.cliTimeoutMs)) && Number(config.cliTimeoutMs) > 0
          ? Number(config.cliTimeoutMs)
          : 60_000,
      })

      return {
        notebookSourceStatus: 'linked',
        notebookSourceId: cliResult?.sourceId || `youtube:${String(videoId || '').trim()}`,
        notebookId: config.notebookId,
        notebookError: null,
      }
    } catch (error) {
      return {
        notebookSourceStatus: 'failed',
        notebookSourceId: null,
        notebookId: config.notebookId,
        notebookError: error instanceof Error ? error.message : 'NotebookLM CLI source 연결에 실패했습니다.',
      }
    }
  }

  try {
    const parent = `projects/${config.projectId}/locations/${config.location}/notebooks/${config.notebookId}`
    const authHeaders = await getNotebookAuthHeaders(config)
    const sources = await listNotebookSources({ parent, config, authHeaders })
    const existingSource = findMatchingYoutubeSource({
      sources,
      videoId,
      videoUrl: resolvedVideoUrl,
    })

    if (existingSource) {
      return {
        notebookSourceStatus: 'linked',
        notebookSourceId: extractSourceId(existingSource) || `youtube:${String(videoId || '').trim()}`,
        notebookId: config.notebookId,
        notebookError: null,
      }
    }

    const createdSource = await createNotebookYoutubeSource({
      parent,
      config,
      authHeaders,
      videoUrl: resolvedVideoUrl,
    })
    if (createdSource) {
      return {
        notebookSourceStatus: 'linked',
        notebookSourceId: extractSourceId(createdSource) || `youtube:${String(videoId || '').trim()}`,
        notebookId: config.notebookId,
        notebookError: null,
      }
    }

    // 일부 응답은 생성된 source를 본문에 직접 주지 않기 때문에, 다시 조회해 최종 확인한다.
    const refreshedSources = await listNotebookSources({ parent, config, authHeaders })
    const matchedSource = findMatchingYoutubeSource({
      sources: refreshedSources,
      videoId,
      videoUrl: resolvedVideoUrl,
    })
    if (matchedSource) {
      return {
        notebookSourceStatus: 'linked',
        notebookSourceId: extractSourceId(matchedSource) || `youtube:${String(videoId || '').trim()}`,
        notebookId: config.notebookId,
        notebookError: null,
      }
    }
  } catch (error) {
    return {
      notebookSourceStatus: 'failed',
      notebookSourceId: null,
      notebookId: config.notebookId,
      notebookError: error instanceof Error ? error.message : 'NotebookLM source 연결에 실패했습니다.',
    }
  }

  return {
    notebookSourceStatus: 'failed',
    notebookSourceId: null,
    notebookId: config.notebookId,
    notebookError: 'NotebookLM source 생성 결과를 확인하지 못했습니다.',
  }
}
