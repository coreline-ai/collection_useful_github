import type { TopSection } from '@shared/types'

type SectionPlaceholderProps = {
  section: Exclude<TopSection, 'github'>
}

const contentBySection: Record<Exclude<TopSection, 'github'>, { title: string; description: string }> = {
  youtube: {
    title: '유튜브',
    description: '유튜브 기능은 준비중입니다.',
  },
  bookmark: {
    title: '북마크',
    description: '북마크 기능은 준비중입니다.',
  },
}

export const SectionPlaceholder = ({ section }: SectionPlaceholderProps) => {
  const content = contentBySection[section]

  return (
    <section className="section-placeholder" aria-live="polite">
      <h2>{content.title}</h2>
      <p>{content.description}</p>
    </section>
  )
}
