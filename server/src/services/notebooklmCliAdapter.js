import { spawn } from 'node:child_process'

const toTrimmedText = (value) => String(value || '').trim()

const parseJsonFromStdout = (stdout) => {
  const text = toTrimmedText(stdout)
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    // Try to parse trailing JSON block when CLI prints logs before JSON.
  }

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch {
      // noop
    }
  }

  return null
}

const runCliJson = async ({ command, args, timeoutMs }) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        const timeoutError = new Error(`NotebookLM CLI timeout (${timeoutMs}ms)`)
        timeoutError.code = 'ETIMEDOUT'
        reject(timeoutError)
        return
      }

      if (code !== 0) {
        const error = new Error(toTrimmedText(stderr) || toTrimmedText(stdout) || `NotebookLM CLI failed (exit ${code})`)
        error.code = `CLI_EXIT_${code}`
        reject(error)
        return
      }

      resolve({
        stdout,
        stderr,
        json: parseJsonFromStdout(stdout),
      })
    })
  })
}

const findSourcesArray = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  if (Array.isArray(payload.sources)) {
    return payload.sources
  }

  if (Array.isArray(payload.items)) {
    return payload.items
  }

  return []
}

const extractSourceId = (source) => {
  if (!source || typeof source !== 'object') {
    return null
  }

  if (typeof source.sourceId === 'string' && source.sourceId.trim()) {
    return source.sourceId.trim()
  }

  const name = toTrimmedText(source.name)
  if (name && name.includes('/sources/')) {
    const parts = name.split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1] : null
  }

  return null
}

const findMatchedSource = ({ sources, videoId, videoUrl }) => {
  const normalizedVideoId = toTrimmedText(videoId).toLowerCase()
  const normalizedVideoUrl = toTrimmedText(videoUrl).toLowerCase()

  return (
    sources.find((source) => {
      const raw = JSON.stringify(source).toLowerCase()
      if (normalizedVideoId && raw.includes(normalizedVideoId)) {
        return true
      }
      if (normalizedVideoUrl && raw.includes(normalizedVideoUrl)) {
        return true
      }
      return false
    }) || null
  )
}

const tryRunCommands = async ({ command, timeoutMs, candidates }) => {
  let lastError = null

  for (const args of candidates) {
    try {
      const output = await runCliJson({
        command,
        args,
        timeoutMs,
      })
      return output
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('NotebookLM CLI command failed')
}

export const ensureYoutubeSourceViaCli = async ({
  videoId,
  videoUrl,
  notebookId,
  command = 'nlm',
  timeoutMs = 60_000,
}) => {
  const normalizedVideoUrl = toTrimmedText(videoUrl)
  if (!normalizedVideoUrl) {
    throw new Error('YouTube video URL is required for NotebookLM CLI source sync.')
  }

  if (!toTrimmedText(notebookId)) {
    throw new Error('Notebook ID is required for NotebookLM CLI source sync.')
  }

  const listCandidates = [
    ['source', 'list', '--notebook', notebookId, '--json'],
    ['sources', 'list', '--notebook', notebookId, '--json'],
    ['source', 'ls', '--notebook', notebookId, '--json'],
  ]

  const listOutput = await tryRunCommands({
    command,
    timeoutMs,
    candidates: listCandidates,
  })

  const existingSources = findSourcesArray(listOutput.json)
  const existingMatch = findMatchedSource({
    sources: existingSources,
    videoId,
    videoUrl: normalizedVideoUrl,
  })
  if (existingMatch) {
    return {
      sourceId: extractSourceId(existingMatch) || `youtube:${toTrimmedText(videoId)}`,
      reused: true,
    }
  }

  const addCandidates = [
    ['source', 'add', '--notebook', notebookId, '--youtube', normalizedVideoUrl, '--json'],
    ['source', 'add', '--notebook', notebookId, '--video-url', normalizedVideoUrl, '--json'],
    ['source', 'create', '--notebook', notebookId, '--youtube', normalizedVideoUrl, '--json'],
  ]

  const addOutput = await tryRunCommands({
    command,
    timeoutMs,
    candidates: addCandidates,
  })

  const addSource = findMatchedSource({
    sources: findSourcesArray(addOutput.json),
    videoId,
    videoUrl: normalizedVideoUrl,
  })

  if (addSource) {
    return {
      sourceId: extractSourceId(addSource) || `youtube:${toTrimmedText(videoId)}`,
      reused: false,
    }
  }

  // Some CLI versions don't return created source in add response.
  const verifyOutput = await tryRunCommands({
    command,
    timeoutMs,
    candidates: listCandidates,
  })
  const verifiedSource = findMatchedSource({
    sources: findSourcesArray(verifyOutput.json),
    videoId,
    videoUrl: normalizedVideoUrl,
  })

  if (!verifiedSource) {
    throw new Error('NotebookLM CLI source create succeeded but source verification failed.')
  }

  return {
    sourceId: extractSourceId(verifiedSource) || `youtube:${toTrimmedText(videoId)}`,
    reused: false,
  }
}
