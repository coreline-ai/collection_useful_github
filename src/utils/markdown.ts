import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

type MarkdownRepoContext = {
  owner: string
  repo: string
  branch: string
}

const ABSOLUTE_URL_REGEX = /^[a-z][a-z0-9+.-]*:/i

const slugify = (value: string): string => {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-가-힣]/g, '')
    .trim()
    .replace(/\s+/g, '-')

  return base || 'section'
}

const withHeadingAnchors = (root: HTMLElement) => {
  const used = new Map<string, number>()
  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6')

  headings.forEach((heading) => {
    const text = heading.textContent?.trim() ?? ''
    if (!text) {
      return
    }

    const baseId = slugify(text)
    const seenCount = used.get(baseId) ?? 0
    used.set(baseId, seenCount + 1)
    const id = seenCount === 0 ? baseId : `${baseId}-${seenCount + 1}`

    heading.id = id

    const anchor = document.createElement('a')
    anchor.className = 'md-heading-anchor'
    anchor.href = `#${id}`
    anchor.setAttribute('aria-label', `${text} 섹션 링크`)
    anchor.textContent = '#'
    heading.insertBefore(anchor, heading.firstChild)
  })
}

const withGitHubLikeLinks = (root: HTMLElement) => {
  const links = root.querySelectorAll<HTMLAnchorElement>('a[href]')

  links.forEach((link) => {
    const href = link.getAttribute('href')

    if (!href || href.startsWith('#')) {
      return
    }

    if (href.startsWith('http://') || href.startsWith('https://')) {
      link.target = '_blank'
      link.rel = 'noreferrer noopener'
    }
  })
}

const encodePath = (path: string): string => path.split('/').map((segment) => encodeURIComponent(segment)).join('/')

const normalizeRelativePath = (path: string): string => {
  const normalizedPath = new URL(path, 'https://example.com/').pathname
  return normalizedPath.replace(/^\/+/, '')
}

const resolveRepoRelativeUrl = (
  value: string,
  context: MarkdownRepoContext,
  mode: 'image' | 'link',
): string => {
  if (!value || value.startsWith('#') || value.startsWith('//') || ABSOLUTE_URL_REGEX.test(value)) {
    return value
  }

  const normalized = normalizeRelativePath(value)
  if (!normalized) {
    return value
  }

  const owner = encodeURIComponent(context.owner)
  const repo = encodeURIComponent(context.repo)
  const branch = encodeURIComponent(context.branch)
  const encodedPath = encodePath(normalized)

  if (mode === 'image') {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodedPath}`
  }

  return `https://github.com/${owner}/${repo}/blob/${branch}/${encodedPath}`
}

const resolveRepoRelativeSrcSet = (value: string, context: MarkdownRepoContext): string =>
  value
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim()
      if (!trimmed) {
        return ''
      }

      const firstWhitespaceIndex = trimmed.search(/\s/)
      if (firstWhitespaceIndex < 0) {
        return resolveRepoRelativeUrl(trimmed, context, 'image')
      }

      const imageUrl = trimmed.slice(0, firstWhitespaceIndex)
      const descriptor = trimmed.slice(firstWhitespaceIndex + 1).trim()
      return `${resolveRepoRelativeUrl(imageUrl, context, 'image')} ${descriptor}`.trim()
    })
    .filter(Boolean)
    .join(', ')

const withRepositoryRelativeUrls = (root: HTMLElement, context?: MarkdownRepoContext) => {
  if (!context) {
    return
  }

  const images = root.querySelectorAll<HTMLImageElement>('img[src]')
  images.forEach((image) => {
    const src = image.getAttribute('src')
    if (!src) {
      return
    }

    image.setAttribute('src', resolveRepoRelativeUrl(src, context, 'image'))

    const srcset = image.getAttribute('srcset')
    if (srcset) {
      image.setAttribute('srcset', resolveRepoRelativeSrcSet(srcset, context))
    }
  })

  const sources = root.querySelectorAll<HTMLElement>('source[srcset]')
  sources.forEach((source) => {
    const srcset = source.getAttribute('srcset')
    if (!srcset) {
      return
    }

    source.setAttribute('srcset', resolveRepoRelativeSrcSet(srcset, context))
  })

  const links = root.querySelectorAll<HTMLAnchorElement>('a[href]')
  links.forEach((link) => {
    const href = link.getAttribute('href')
    if (!href) {
      return
    }

    link.setAttribute('href', resolveRepoRelativeUrl(href, context, 'link'))
  })
}

const withTaskListClasses = (root: HTMLElement) => {
  const lists = root.querySelectorAll('ul, ol')

  lists.forEach((list) => {
    const items = Array.from(list.children).filter(
      (child): child is HTMLLIElement => child.tagName.toLowerCase() === 'li',
    )
    if (items.length === 0) {
      return
    }

    const isTaskList = items.every((item) => {
      const firstElement = item.firstElementChild
      return firstElement?.tagName.toLowerCase() === 'input' && (firstElement as HTMLInputElement).type === 'checkbox'
    })

    if (!isTaskList) {
      return
    }

    list.classList.add('md-task-list')
    items.forEach((item) => {
      item.classList.add('md-task-list-item')
    })
  })
}

const postProcessMarkdownHtml = (rawHtml: string, context?: MarkdownRepoContext): string => {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html')
  const root = doc.body

  withHeadingAnchors(root)
  withRepositoryRelativeUrls(root, context)
  withGitHubLikeLinks(root)
  withTaskListClasses(root)

  return root.innerHTML
}

export const renderMarkdownToSafeHtml = (markdown: string, context?: MarkdownRepoContext): string => {
  if (!markdown.trim()) {
    return ''
  }

  const parsed = marked.parse(markdown, { async: false })
  const rawHtml = typeof parsed === 'string' ? parsed : ''
  const processedHtml = postProcessMarkdownHtml(rawHtml, context)

  return DOMPurify.sanitize(processedHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style'],
    FORBID_ATTR: ['onerror', 'onload'],
    ADD_ATTR: ['id', 'class', 'aria-label', 'target', 'rel'],
  })
}
