import { describe, expect, it } from 'vitest'
import { parseGitHubRepoUrl } from './parseGitHubRepoUrl'

describe('parseGitHubRepoUrl', () => {
  it.each([
    ['https://github.com/facebook/react', { owner: 'facebook', repo: 'react' }],
    ['http://github.com/vercel/next.js', { owner: 'vercel', repo: 'next.js' }],
    ['github.com/microsoft/TypeScript/', { owner: 'microsoft', repo: 'TypeScript' }],
    ['https://github.com/tanstack/query?tab=readme-ov-file', { owner: 'tanstack', repo: 'query' }],
    ['owner-name/repo_name.git', { owner: 'owner-name', repo: 'repo_name' }],
  ])('parses valid input: %s', (input, expected) => {
    expect(parseGitHubRepoUrl(input)).toEqual(expected)
  })

  it.each([
    '',
    'not a url',
    'https://example.com/facebook/react',
    'https://github.com/facebook',
    'https://github.com//react',
  ])('rejects invalid input: %s', (input) => {
    expect(parseGitHubRepoUrl(input)).toBeNull()
  })
})
