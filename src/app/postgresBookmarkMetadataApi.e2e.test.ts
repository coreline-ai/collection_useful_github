import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const API_BASE =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VITE_POSTGRES_SYNC_API_BASE_URL ?? 'http://localhost:4000'
const shouldRunPostgresE2E =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.RUN_POSTGRES_E2E === 'true'

const describeIfPostgresE2E = shouldRunPostgresE2E ? describe : describe.skip

describeIfPostgresE2E('PostgreSQL bookmark metadata api E2E', () => {
  beforeAll(async () => {
    vi.stubEnv('VITE_POSTGRES_SYNC_API_BASE_URL', API_BASE)

    const health = await fetch(`${API_BASE}/api/health`)
    if (!health.ok) {
      throw new Error('PostgreSQL API server is not healthy')
    }
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('rejects non-http scheme url', async () => {
    const response = await fetch(`${API_BASE}/api/bookmark/metadata?url=${encodeURIComponent('file:///etc/passwd')}`)
    const payload = (await response.json()) as { ok?: boolean; message?: string }

    expect(response.status).toBe(400)
    expect(payload.ok).toBe(false)
  })

  it('rejects url with embedded credentials', async () => {
    const response = await fetch(
      `${API_BASE}/api/bookmark/metadata?url=${encodeURIComponent('https://user:pass@example.com/path')}`,
    )
    const payload = (await response.json()) as { ok?: boolean; message?: string }

    expect(response.status).toBe(400)
    expect(payload.ok).toBe(false)
  })

  it('rejects localhost/private target url', async () => {
    const response = await fetch(
      `${API_BASE}/api/bookmark/metadata?url=${encodeURIComponent('http://localhost:3000/test')}`,
    )
    const payload = (await response.json()) as { ok?: boolean; message?: string }

    expect(response.status).toBe(422)
    expect(payload.ok).toBe(false)
  })

  it('falls back when remote page cannot be fetched', async () => {
    const unreachable = 'http://this-domain-should-not-resolve.invalid/path?b=2&utm_source=abc&a=1'
    const response = await fetch(`${API_BASE}/api/bookmark/metadata?url=${encodeURIComponent(unreachable)}`)
    const payload = (await response.json()) as {
      ok: boolean
      metadata: {
        normalizedUrl: string
        domain: string
        metadataStatus: 'ok' | 'fallback'
      }
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.metadata.metadataStatus).toBe('fallback')
    expect(payload.metadata.domain).toBe('this-domain-should-not-resolve.invalid')
    expect(payload.metadata.normalizedUrl).toBe('http://this-domain-should-not-resolve.invalid/path?a=1&b=2')
  })
})
