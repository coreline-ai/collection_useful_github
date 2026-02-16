export type TranslationKind = 'plain' | 'markdown'

type OpenAIResponsesOutput = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

type GlmChatOutput = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string
            text?: string
          }>
    }
  }>
}

type TranslationItem = {
  index: number
  text: string
}

type ProviderConfig =
  | {
      provider: 'glm'
      apiKey: string
      baseUrl: string
      model: string
      timeoutMs: number
    }
  | {
      provider: 'openai'
      apiKey: string
      model: string
      timeoutMs: number
    }

const readEnv = (key: string): string => {
  const value = (import.meta.env as Record<string, string | undefined>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

const readEnvNumber = (key: string, fallback: number): number => {
  const raw = readEnv(key)
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const getProviderConfig = (): ProviderConfig | null => {
  const glmApiKey = readEnv('GLM_API_KEY') || readEnv('VITE_GLM_API_KEY')

  if (glmApiKey) {
    const baseUrl = readEnv('GLM_BASE_URL') || readEnv('VITE_GLM_BASE_URL') || 'https://api.z.ai/api/coding/paas/v4'
    const model = readEnv('GLM_MODEL') || readEnv('VITE_GLM_MODEL') || 'glm-4.7'
    const timeoutSeconds =
      readEnvNumber('GLM_TIMEOUT_SECONDS', 30) || readEnvNumber('VITE_GLM_TIMEOUT_SECONDS', 30)

    return {
      provider: 'glm',
      apiKey: glmApiKey,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      model,
      timeoutMs: Math.floor(timeoutSeconds * 1000),
    }
  }

  const openAiApiKey = readEnv('VITE_OPENAI_API_KEY')

  if (openAiApiKey) {
    const model = readEnv('VITE_OPENAI_MODEL') || 'gpt-4.1-mini'
    const timeoutSeconds = readEnvNumber('VITE_OPENAI_TIMEOUT_SECONDS', 30)

    return {
      provider: 'openai',
      apiKey: openAiApiKey,
      model,
      timeoutMs: Math.floor(timeoutSeconds * 1000),
    }
  }

  return null
}

const getOutputText = (payload: OpenAIResponsesOutput): string => {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const fromContent =
    payload.output
      ?.flatMap((entry) => entry.content ?? [])
      .map((content) => content.text ?? '')
      .join('\n')
      .trim() ?? ''

  return fromContent
}

const getGlmOutputText = (payload: GlmChatOutput): string => {
  const content = payload.choices?.[0]?.message?.content

  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? '')
      .join('\n')
      .trim()
  }

  return ''
}

const parseTranslations = (rawText: string, count: number): string[] | null => {
  if (!rawText.trim()) {
    return null
  }

  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? rawText).trim()

  try {
    const parsed = JSON.parse(candidate) as { translations?: TranslationItem[] } | TranslationItem[]
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.translations)
        ? parsed.translations
        : []

    if (list.length === 0) {
      return null
    }

    const normalized = Array.from({ length: count }, () => '')

    list.forEach((item) => {
      if (typeof item.index !== 'number') {
        return
      }

      if (item.index < 0 || item.index >= count) {
        return
      }

      normalized[item.index] = typeof item.text === 'string' ? item.text : ''
    })

    return normalized
  } catch {
    return null
  }
}

const buildPrompt = (segments: string[], kind: TranslationKind): string => {
  const toneInstruction =
    kind === 'markdown'
      ? 'Translate to Korean while preserving Markdown structure, links, images, tables, and code blocks exactly.'
      : 'Translate to natural Korean with concise technical wording.'

  const payload = segments.map((text, index) => ({ index, text }))

  return [
    'You are a professional software localization translator.',
    toneInstruction,
    'Return JSON only. No explanation. Use shape: {"translations":[{"index":0,"text":"..."}]}.',
    'Do not change index order. Keep empty text empty.',
    '',
    JSON.stringify({ items: payload }),
  ].join('\n')
}

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
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

const requestTranslationsViaOpenAI = async (
  config: Extract<ProviderConfig, { provider: 'openai' }>,
  prompt: string,
): Promise<string | null> => {
  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: prompt,
        temperature: 0.1,
      }),
    },
    config.timeoutMs,
  )

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as OpenAIResponsesOutput
  return getOutputText(payload)
}

const requestTranslationsViaGlm = async (
  config: Extract<ProviderConfig, { provider: 'glm' }>,
  prompt: string,
): Promise<string | null> => {
  const response = await fetchWithTimeout(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'You translate software documentation and UI text into Korean.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    },
    config.timeoutMs,
  )

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as GlmChatOutput
  return getGlmOutputText(payload)
}

export const translateBatchToKorean = async (
  segments: string[],
  kind: TranslationKind = 'plain',
): Promise<string[]> => {
  const config = getProviderConfig()

  if (!config) {
    return segments
  }

  if (segments.length === 0) {
    return segments
  }

  const prepared = segments.map((segment) => segment.trim())
  const hasContent = prepared.some((segment) => segment.length > 0)

  if (!hasContent) {
    return segments
  }

  const prompt = buildPrompt(prepared, kind)

  try {
    const outputText =
      config.provider === 'glm'
        ? await requestTranslationsViaGlm(config, prompt)
        : await requestTranslationsViaOpenAI(config, prompt)

    if (!outputText) {
      return segments
    }

    const parsed = parseTranslations(outputText, segments.length)

    if (!parsed) {
      return segments
    }

    return segments.map((original, index) => {
      const translated = parsed[index]?.trim()
      return translated ? translated : original
    })
  } catch {
    return segments
  }
}

export const translateToKorean = async (
  text: string,
  kind: TranslationKind = 'plain',
): Promise<string> => {
  const [translated] = await translateBatchToKorean([text], kind)
  return translated
}
