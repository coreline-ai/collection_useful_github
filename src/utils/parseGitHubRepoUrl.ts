const REPO_PATH_REGEX = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/

const normalizeRepoName = (repo: string): string => repo.replace(/\.git$/i, '')

export type ParsedRepo = {
  owner: string
  repo: string
}

export const parseGitHubRepoUrl = (input: string): ParsedRepo | null => {
  const trimmed = input.trim()

  if (!trimmed) {
    return null
  }

  const directMatch = trimmed.match(REPO_PATH_REGEX)
  if (directMatch) {
    const [, owner, repoRaw] = directMatch
    const repo = normalizeRepoName(repoRaw)
    return repo ? { owner, repo } : null
  }

  const urlLike = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.startsWith('github.com/')
      ? `https://${trimmed}`
      : trimmed

  let parsedUrl: URL

  try {
    parsedUrl = new URL(urlLike)
  } catch {
    return null
  }

  const host = parsedUrl.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') {
    return null
  }

  const segments = parsedUrl.pathname.split('/').filter(Boolean)
  if (segments.length < 2) {
    return null
  }

  const owner = segments[0]
  const repo = normalizeRepoName(segments[1])

  if (!owner || !repo) {
    return null
  }

  if (!owner.match(/^[A-Za-z0-9_.-]+$/) || !repo.match(/^[A-Za-z0-9_.-]+$/)) {
    return null
  }

  return { owner, repo }
}
