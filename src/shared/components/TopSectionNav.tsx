import { TOP_SECTION_LABEL, TOP_SECTION_ORDER } from '@core/navigation/topSection'
import type { TopSection } from '@shared/types'

type TopSectionNavProps = {
  activeSection: TopSection
  onChangeSection: (section: TopSection) => void
}

export const TopSectionNav = ({ activeSection, onChangeSection }: TopSectionNavProps) => {
  return (
    <section className="top-section-nav" aria-label="글로벌 메뉴">
      <nav className="top-section-tabs" role="tablist" aria-label="서비스 전환 탭">
        {TOP_SECTION_ORDER.map((section) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={activeSection === section}
            className={activeSection === section ? 'active' : ''}
            onClick={() => onChangeSection(section)}
          >
            {TOP_SECTION_LABEL[section]}
          </button>
        ))}
      </nav>
    </section>
  )
}
