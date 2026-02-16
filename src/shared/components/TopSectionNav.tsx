import { TOP_SECTION_LABEL, TOP_SECTION_ORDER } from '@core/navigation/topSection'
import { SyncStatusBadge } from '@shared/components/SyncStatusBadge'
import type { SyncConnectionStatus, TopSection } from '@shared/types'

type TopSectionNavProps = {
  activeSection: TopSection
  onChangeSection: (section: TopSection) => void
  syncStatus?: SyncConnectionStatus
  lastSyncSuccessAt?: string | null
}

export const TopSectionNav = ({
  activeSection,
  onChangeSection,
  syncStatus,
  lastSyncSuccessAt,
}: TopSectionNavProps) => {
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
      {syncStatus ? (
        <div className="top-section-sync">
          <SyncStatusBadge status={syncStatus} lastSuccessAt={lastSyncSuccessAt} />
        </div>
      ) : null}
    </section>
  )
}
