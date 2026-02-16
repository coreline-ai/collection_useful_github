const MAX_SUMMARY_LENGTH = 220

const sanitizeMarkdown = (content: string): string =>
  content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

const clipSummary = (text: string): string => {
  if (text.length <= MAX_SUMMARY_LENGTH) {
    return text
  }

  return `${text.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`
}

const pickReadmeSnippet = (readme: string | null): string => {
  if (!readme) {
    return ''
  }

  const sanitized = sanitizeMarkdown(readme)
  if (!sanitized) {
    return ''
  }

  return sanitized.split(/(?<=[.!?])\s+/).find((sentence) => sentence.length >= 40) ?? sanitized.slice(0, 120)
}

export const buildSummary = (description: string, readme: string | null): string => {
  const normalizedDescription = description.replace(/\s+/g, ' ').trim()
  const readmeSnippet = pickReadmeSnippet(readme)

  const chunks = [normalizedDescription, readmeSnippet].filter(Boolean)

  if (chunks.length === 0) {
    return 'No description available for this repository yet.'
  }

  const combined = chunks.join(' ').replace(/\s+/g, ' ').trim()
  return clipSummary(combined)
}
