import { afterAll, describe, expect, it, vi } from 'vitest'
import { translateBatchToKorean, translateToKorean } from './translation'

describe('translation service', () => {
  const originalGlmKey = import.meta.env.GLM_API_KEY
  const originalGlmBase = import.meta.env.GLM_BASE_URL
  const originalGlmModel = import.meta.env.GLM_MODEL
  const originalOpenAiKey = import.meta.env.VITE_OPENAI_API_KEY

  const resetEnv = () => {
    Object.assign(import.meta.env, {
      GLM_API_KEY: '',
      GLM_BASE_URL: '',
      GLM_MODEL: '',
      VITE_OPENAI_API_KEY: '',
    })
  }

  it('returns original text when no API key is configured', async () => {
    resetEnv()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const translated = await translateBatchToKorean(['Hello world', ''], 'plain')

    expect(translated).toEqual(['Hello world', ''])
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('single translation helper keeps original when key missing', async () => {
    resetEnv()
    const translated = await translateToKorean('README title', 'markdown')
    expect(translated).toBe('README title')
  })

  it('falls back to original when translation response is malformed', async () => {
    Object.assign(import.meta.env, {
      GLM_API_KEY: 'test-key',
      GLM_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
    })

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    const translated = await translateBatchToKorean(['Alpha'], 'plain')

    expect(translated).toEqual(['Alpha'])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockRestore()
  })

  afterAll(() => {
    Object.assign(import.meta.env, {
      GLM_API_KEY: originalGlmKey,
      GLM_BASE_URL: originalGlmBase,
      GLM_MODEL: originalGlmModel,
      VITE_OPENAI_API_KEY: originalOpenAiKey,
    })
  })
})
