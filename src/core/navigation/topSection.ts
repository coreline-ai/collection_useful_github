import type { TopSection } from '@shared/types'

export const TOP_SECTION_ORDER: TopSection[] = ['github', 'youtube', 'bookmark']

export const TOP_SECTION_LABEL: Record<TopSection, string> = {
  github: '깃허브',
  youtube: '유튜브',
  bookmark: '북마크',
}

export const isTopSection = (value: unknown): value is TopSection =>
  value === 'github' || value === 'youtube' || value === 'bookmark'
