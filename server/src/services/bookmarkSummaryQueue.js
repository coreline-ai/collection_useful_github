import crypto from 'node:crypto'
import { query } from '../db.js'

const SUMMARY_JOB_PROMPT_VERSION = process.env.BOOKMARK_SUMMARY_PROMPT_VERSION || 'v1'
const SUMMARY_CACHE_TTL_SECONDS = Number(process.env.BOOKMARK_SUMMARY_CACHE_TTL_SECONDS || 7 * 24 * 60 * 60)
const SUMMARY_JOB_MAX_ATTEMPTS = Number(process.env.BOOKMARK_SUMMARY_MAX_ATTEMPTS || 5)
const SUMMARY_STALE_LOCK_MS = Number(process.env.BOOKMARK_SUMMARY_STALE_LOCK_MS || 120_000)

const toIso = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }

  return date.toISOString()
}

const normalizeJobStatus = (value) => {
  if (value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'dead') {
    return value
  }

  return 'queued'
}

const normalizeSummaryProvider = (value) => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().toLowerCase()
  }

  return 'glm'
}

const mapJobRow = (row) => {
  if (!row) {
    return null
  }

  return {
    id: Number(row.id),
    bookmarkId: String(row.bookmarkId || row.bookmark_id || ''),
    requestKey: String(row.requestKey || row.request_key || ''),
    status: normalizeJobStatus(row.status),
    attemptCount: Number(row.attemptCount ?? row.attempt_count ?? 0),
    maxAttempts: Number(row.maxAttempts ?? row.max_attempts ?? SUMMARY_JOB_MAX_ATTEMPTS),
    nextRunAt: toIso(row.nextRunAt ?? row.next_run_at ?? new Date()),
    lockedAt: row.lockedAt || row.locked_at ? toIso(row.lockedAt || row.locked_at) : null,
    lockedBy: row.lockedBy || row.locked_by ? String(row.lockedBy || row.locked_by) : null,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    resultSummary: row.resultSummary || row.result_summary ? String(row.resultSummary || row.result_summary) : null,
    errorCode: row.errorCode || row.error_code ? String(row.errorCode || row.error_code) : null,
    errorMessage: row.errorMessage || row.error_message ? String(row.errorMessage || row.error_message) : null,
    createdAt: toIso(row.createdAt ?? row.created_at ?? new Date()),
    updatedAt: toIso(row.updatedAt ?? row.updated_at ?? new Date()),
  }
}

export const buildBookmarkSummaryMetadataHash = (metadata) => {
  const payload = {
    bookmarkId: String(metadata?.bookmarkId || metadata?.normalizedUrl || ''),
    title: String(metadata?.title || ''),
    excerpt: String(metadata?.excerpt || ''),
    domain: String(metadata?.domain || ''),
    normalizedUrl: String(metadata?.normalizedUrl || metadata?.bookmarkId || ''),
  }

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export const buildBookmarkSummaryRequestKey = ({ bookmarkId, metadataHash, promptVersion, force }) => {
  const raw = `${String(bookmarkId || '').trim()}|${String(metadataHash || '')}|${String(promptVersion || SUMMARY_JOB_PROMPT_VERSION)}|${
    force ? 'force' : 'normal'
  }`
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export const getBookmarkSummaryPromptVersion = () =>
  String(process.env.BOOKMARK_SUMMARY_PROMPT_VERSION || SUMMARY_JOB_PROMPT_VERSION)

export const getBookmarkSummaryCacheTtlMs = () => {
  const seconds =
    Number.isFinite(SUMMARY_CACHE_TTL_SECONDS) && SUMMARY_CACHE_TTL_SECONDS > 0
      ? SUMMARY_CACHE_TTL_SECONDS
      : 7 * 24 * 60 * 60
  return Math.floor(seconds * 1000)
}

export const getBookmarkSummaryMaxAttempts = () => {
  const value = Number(SUMMARY_JOB_MAX_ATTEMPTS)
  return Number.isInteger(value) && value > 0 ? value : 5
}

export const getBookmarkSummaryStaleLockMs = () => {
  const value = Number(SUMMARY_STALE_LOCK_MS)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 120_000
}

export const getBookmarkSummaryCache = async ({ bookmarkId, metadataHash, promptVersion, provider }) => {
  const result = await query(
    `
      SELECT
        bookmark_id AS "bookmarkId",
        metadata_hash AS "metadataHash",
        prompt_version AS "promptVersion",
        provider,
        summary_text AS "summaryText",
        generated_at AS "generatedAt",
        expires_at AS "expiresAt",
        last_success_at AS "lastSuccessAt"
      FROM bookmark_summary_cache
      WHERE bookmark_id = $1
        AND metadata_hash = $2
        AND prompt_version = $3
        AND provider = $4
        AND expires_at > NOW()
      LIMIT 1
    `,
    [bookmarkId, metadataHash, promptVersion, normalizeSummaryProvider(provider)],
  )

  if (!result.rowCount) {
    return null
  }

  const row = result.rows[0]
  return {
    bookmarkId: String(row.bookmarkId),
    metadataHash: String(row.metadataHash),
    promptVersion: String(row.promptVersion),
    provider: normalizeSummaryProvider(row.provider),
    summaryText: String(row.summaryText || ''),
    generatedAt: toIso(row.generatedAt),
    expiresAt: toIso(row.expiresAt),
    lastSuccessAt: toIso(row.lastSuccessAt),
  }
}

export const upsertBookmarkSummaryCache = async ({
  bookmarkId,
  metadataHash,
  promptVersion,
  provider,
  summaryText,
  ttlMs = getBookmarkSummaryCacheTtlMs(),
}) => {
  const expiresAt = new Date(Date.now() + Math.max(10_000, Number(ttlMs) || 0)).toISOString()
  const now = new Date().toISOString()

  await query(
    `
      INSERT INTO bookmark_summary_cache (
        bookmark_id, metadata_hash, prompt_version, provider, summary_text,
        generated_at, expires_at, last_success_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6::timestamptz, $7::timestamptz, $8::timestamptz
      )
      ON CONFLICT (bookmark_id)
      DO UPDATE SET
        metadata_hash = EXCLUDED.metadata_hash,
        prompt_version = EXCLUDED.prompt_version,
        provider = EXCLUDED.provider,
        summary_text = EXCLUDED.summary_text,
        generated_at = EXCLUDED.generated_at,
        expires_at = EXCLUDED.expires_at,
        last_success_at = EXCLUDED.last_success_at
    `,
    [
      bookmarkId,
      metadataHash,
      promptVersion,
      normalizeSummaryProvider(provider),
      String(summaryText || ''),
      now,
      expiresAt,
      now,
    ],
  )
}

export const enqueueBookmarkSummaryJob = async ({
  bookmarkId,
  metadataHash,
  promptVersion = getBookmarkSummaryPromptVersion(),
  force = false,
  payload = {},
  maxAttempts = getBookmarkSummaryMaxAttempts(),
}) => {
  const requestKey = buildBookmarkSummaryRequestKey({ bookmarkId, metadataHash, promptVersion, force })
  const staleLockMs = getBookmarkSummaryStaleLockMs()
  const mergedPayload = {
    ...payload,
    force: Boolean(force),
    metadataHash,
    promptVersion,
  }

  const result = await query(
    `
      INSERT INTO bookmark_summary_jobs (
        bookmark_id, request_key, status, attempt_count, max_attempts, next_run_at, payload, updated_at
      ) VALUES (
        $1, $2, 'queued', 0, $3, NOW(), $4::jsonb, NOW()
      )
      ON CONFLICT (request_key)
      DO UPDATE SET
        payload = EXCLUDED.payload,
        max_attempts = EXCLUDED.max_attempts,
        updated_at = NOW(),
        status = CASE
          WHEN bookmark_summary_jobs.status IN ('failed', 'dead') THEN 'queued'
          WHEN bookmark_summary_jobs.status = 'running'
            AND (
              bookmark_summary_jobs.locked_at IS NULL
              OR bookmark_summary_jobs.locked_at < NOW() - (($5::bigint || ' milliseconds')::interval)
            ) THEN 'queued'
          ELSE bookmark_summary_jobs.status
        END,
        next_run_at = CASE
          WHEN bookmark_summary_jobs.status IN ('failed', 'dead') THEN NOW()
          WHEN bookmark_summary_jobs.status = 'running'
            AND (
              bookmark_summary_jobs.locked_at IS NULL
              OR bookmark_summary_jobs.locked_at < NOW() - (($5::bigint || ' milliseconds')::interval)
            ) THEN NOW()
          ELSE bookmark_summary_jobs.next_run_at
        END,
        attempt_count = CASE
          WHEN bookmark_summary_jobs.status IN ('failed', 'dead') THEN 0
          WHEN bookmark_summary_jobs.status = 'running'
            AND (
              bookmark_summary_jobs.locked_at IS NULL
              OR bookmark_summary_jobs.locked_at < NOW() - (($5::bigint || ' milliseconds')::interval)
            ) THEN 0
          ELSE bookmark_summary_jobs.attempt_count
        END
      RETURNING
        id,
        bookmark_id AS "bookmarkId",
        request_key AS "requestKey",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        locked_at AS "lockedAt",
        locked_by AS "lockedBy",
        payload,
        result_summary AS "resultSummary",
        error_code AS "errorCode",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      bookmarkId,
      requestKey,
      Math.max(1, Number(maxAttempts) || getBookmarkSummaryMaxAttempts()),
      JSON.stringify(mergedPayload),
      staleLockMs,
    ],
  )

  return mapJobRow(result.rows[0])
}

export const claimNextBookmarkSummaryJob = async ({ workerId }) => {
  const result = await query(
    `
      UPDATE bookmark_summary_jobs
      SET
        status = 'running',
        locked_at = NOW(),
        locked_by = $1,
        attempt_count = attempt_count + 1,
        updated_at = NOW()
      WHERE id = (
        SELECT id
        FROM bookmark_summary_jobs
        WHERE status = 'queued'
          AND next_run_at <= NOW()
        ORDER BY next_run_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING
        id,
        bookmark_id AS "bookmarkId",
        request_key AS "requestKey",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        locked_at AS "lockedAt",
        locked_by AS "lockedBy",
        payload,
        result_summary AS "resultSummary",
        error_code AS "errorCode",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [String(workerId || `worker-${process.pid}`)],
  )

  if (!result.rowCount) {
    return null
  }

  return mapJobRow(result.rows[0])
}

export const markBookmarkSummaryJobSucceeded = async ({ jobId, summaryText }) => {
  const result = await query(
    `
      UPDATE bookmark_summary_jobs
      SET
        status = 'succeeded',
        result_summary = $2,
        error_code = NULL,
        error_message = NULL,
        locked_at = NULL,
        locked_by = NULL,
        next_run_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        bookmark_id AS "bookmarkId",
        request_key AS "requestKey",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        locked_at AS "lockedAt",
        locked_by AS "lockedBy",
        payload,
        result_summary AS "resultSummary",
        error_code AS "errorCode",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [jobId, String(summaryText || '')],
  )

  return mapJobRow(result.rows[0])
}

export const markBookmarkSummaryJobFailed = async ({
  jobId,
  retryable,
  errorCode,
  errorMessage,
  nextRunAt,
}) => {
  const fallbackStatus = retryable ? 'queued' : 'failed'
  const safeNextRunAt = nextRunAt ? toIso(nextRunAt) : new Date().toISOString()

  const result = await query(
    `
      UPDATE bookmark_summary_jobs
      SET
        status = CASE
          WHEN $2::boolean = TRUE AND attempt_count < max_attempts THEN 'queued'
          WHEN $2::boolean = TRUE AND attempt_count >= max_attempts THEN 'dead'
          ELSE $3
        END,
        error_code = $4,
        error_message = $5,
        locked_at = NULL,
        locked_by = NULL,
        next_run_at = CASE
          WHEN $2::boolean = TRUE AND attempt_count < max_attempts THEN $6::timestamptz
          ELSE NOW()
        END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        bookmark_id AS "bookmarkId",
        request_key AS "requestKey",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        locked_at AS "lockedAt",
        locked_by AS "lockedBy",
        payload,
        result_summary AS "resultSummary",
        error_code AS "errorCode",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [jobId, Boolean(retryable), fallbackStatus, errorCode || null, errorMessage || null, safeNextRunAt],
  )

  return mapJobRow(result.rows[0])
}

export const recoverStuckBookmarkSummaryJobs = async ({ staleMs = getBookmarkSummaryStaleLockMs() } = {}) => {
  const safeStaleMs = Number.isFinite(Number(staleMs)) && Number(staleMs) > 0 ? Math.floor(Number(staleMs)) : 120_000
  await query(
    `
      UPDATE bookmark_summary_jobs
      SET
        status = CASE
          WHEN attempt_count >= max_attempts THEN 'dead'
          ELSE 'queued'
        END,
        locked_at = NULL,
        locked_by = NULL,
        next_run_at = NOW(),
        error_code = CASE
          WHEN attempt_count >= max_attempts THEN error_code
          ELSE NULL
        END,
        error_message = CASE
          WHEN attempt_count >= max_attempts THEN error_message
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE status = 'running'
        AND locked_at IS NOT NULL
        AND locked_at < NOW() - (($1::bigint || ' milliseconds')::interval)
    `,
    [safeStaleMs],
  )
}

export const getLatestBookmarkSummaryJobByBookmarkId = async (bookmarkId) => {
  const result = await query(
    `
      SELECT
        id,
        bookmark_id AS "bookmarkId",
        request_key AS "requestKey",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        locked_at AS "lockedAt",
        locked_by AS "lockedBy",
        payload,
        result_summary AS "resultSummary",
        error_code AS "errorCode",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM bookmark_summary_jobs
      WHERE bookmark_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [bookmarkId],
  )

  if (!result.rowCount) {
    return null
  }

  return mapJobRow(result.rows[0])
}
