import {
  claimNextGithubSummaryJob,
  getGithubSummaryStaleLockMs,
  markGithubSummaryJobFailed,
  markGithubSummaryJobSucceeded,
  recoverStuckGithubSummaryJobs,
} from './githubSummaryQueue.js'

const DEFAULT_WORKER_POLL_INTERVAL_MS = Number(process.env.GITHUB_SUMMARY_WORKER_POLL_INTERVAL_MS || 1500)
const DEFAULT_WORKER_STALE_LOCK_MS = getGithubSummaryStaleLockMs()
const DEFAULT_WORKER_RECOVERY_INTERVAL_MS = Number(process.env.GITHUB_SUMMARY_RECOVERY_INTERVAL_MS || 30 * 1000)

export const computeGithubSummaryRetryDelayMs = (attemptCount) => {
  const schedule = [30_000, 120_000, 600_000, 3_600_000, 21_600_000]
  const index = Math.max(0, Math.min(schedule.length - 1, Number(attemptCount || 1) - 1))
  const baseMs = schedule[index]
  const jitter = Math.floor(baseMs * 0.2 * Math.random())
  return baseMs + jitter
}

export const classifyGithubSummaryError = (error) => {
  const status = typeof error?.status === 'number' ? Number(error.status) : null
  const message = String(error?.message || '').toLowerCase()
  const code = String(error?.code || '').toLowerCase()
  const retryableCodes = new Set(['etimedout', 'econnreset', 'econnrefused', 'eai_again', 'enotfound'])

  if (status === 429 || status === 408 || (status !== null && status >= 500)) {
    return { retryable: true, errorCode: `http_${status}` }
  }

  if (
    retryableCodes.has(code) ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('temporarily') ||
    message.includes('failed to fetch')
  ) {
    return { retryable: true, errorCode: code || 'transient_network' }
  }

  if (status === 401 || status === 403) {
    return { retryable: false, errorCode: `http_${status}` }
  }

  if (message.includes('api_key') || message.includes('invalid') || message.includes('not found')) {
    return { retryable: false, errorCode: 'invalid_request' }
  }

  return { retryable: false, errorCode: code || 'job_failed' }
}

export const startGithubSummaryWorker = ({
  workerId = `gh-summary-worker-${process.pid}`,
  pollIntervalMs = DEFAULT_WORKER_POLL_INTERVAL_MS,
  staleLockMs = DEFAULT_WORKER_STALE_LOCK_MS,
  recoveryIntervalMs = DEFAULT_WORKER_RECOVERY_INTERVAL_MS,
  processJob,
  onError,
} = {}) => {
  if (typeof processJob !== 'function') {
    throw new Error('processJob callback is required to start github summary worker')
  }

  const safePollInterval = Number.isFinite(Number(pollIntervalMs)) && Number(pollIntervalMs) > 100 ? Number(pollIntervalMs) : 1500
  const safeRecoveryInterval =
    Number.isFinite(Number(recoveryIntervalMs)) && Number(recoveryIntervalMs) > 1000 ? Number(recoveryIntervalMs) : 30_000

  let stopped = false
  let busy = false
  let lastRecoveryAt = 0

  const processNext = async () => {
    if (stopped || busy) {
      return
    }

    busy = true
    try {
      const now = Date.now()
      if (now - lastRecoveryAt >= safeRecoveryInterval) {
        lastRecoveryAt = now
        await recoverStuckGithubSummaryJobs({ staleMs: staleLockMs })
      }

      const job = await claimNextGithubSummaryJob({ workerId })
      if (!job) {
        return
      }

      try {
        const result = await processJob(job)
        await markGithubSummaryJobSucceeded({
          jobId: job.id,
          summaryText: result?.summaryText || result?.resultSummary || '',
        })
      } catch (error) {
        const { retryable, errorCode } = classifyGithubSummaryError(error)
        const errorMessage = error instanceof Error ? error.message : '요약 워커 실행에 실패했습니다.'
        const nextRunAt = new Date(Date.now() + computeGithubSummaryRetryDelayMs(job.attemptCount)).toISOString()

        await markGithubSummaryJobFailed({
          jobId: job.id,
          retryable,
          errorCode,
          errorMessage,
          nextRunAt,
        })

        if (typeof onError === 'function') {
          onError(error, job)
        }
      }
    } catch (error) {
      if (typeof onError === 'function') {
        onError(error, null)
      }
    } finally {
      busy = false
    }
  }

  const intervalId = setInterval(() => {
    void processNext()
  }, safePollInterval)
  intervalId.unref?.()

  void processNext()

  return {
    trigger: () => {
      void processNext()
    },
    stop: () => {
      stopped = true
      clearInterval(intervalId)
    },
  }
}
