import { describe, expect, it } from 'vitest'
import { renderMarkdownToSafeHtml } from './markdown'

describe('renderMarkdownToSafeHtml', () => {
  it('renders markdown, heading anchors, table, and task list classes', () => {
    const html = renderMarkdownToSafeHtml([
      '# Hello World',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '- [x] done',
      '- [ ] todo',
    ].join('\n'))

    expect(html).toContain('id="hello-world"')
    expect(html).toContain('class="md-heading-anchor"')
    expect(html).toContain('<table>')
    expect(html).toContain('class="md-task-list"')
    expect(html).toContain('type="checkbox"')
  })

  it('resolves repository-relative image and link urls', () => {
    const html = renderMarkdownToSafeHtml(
      [
        '<picture><source media="(prefers-color-scheme: dark)" srcset="/images/logo-dark.png 1x, /images/logo-dark@2x.png 2x"><img src="./images/logo.png" /></picture>',
        '[docs](docs/guide.md)',
        '[anchor](#section)',
      ].join('\n'),
      {
        owner: 'openai',
        repo: 'openai-cookbook',
        branch: 'main',
      },
    )

    expect(html).toContain(
      'src="https://raw.githubusercontent.com/openai/openai-cookbook/main/images/logo.png"',
    )
    expect(html).toContain(
      'srcset="https://raw.githubusercontent.com/openai/openai-cookbook/main/images/logo-dark.png 1x, https://raw.githubusercontent.com/openai/openai-cookbook/main/images/logo-dark%402x.png 2x"',
    )
    expect(html).toContain('href="https://github.com/openai/openai-cookbook/blob/main/docs/guide.md"')
    expect(html).toContain('href="#section"')
  })

  it('sanitizes dangerous html', () => {
    const html = renderMarkdownToSafeHtml(
      '[safe](https://example.com) <img src=x onerror="alert(1)"><script>alert(1)</script>',
    )

    expect(html).not.toContain('script')
    expect(html).not.toContain('onerror')
    expect(html).toContain('https://example.com')
  })
})
