import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Category } from '@shared/types'

type CategorySettingsModalProps = {
  open: boolean
  categories: Category[]
  maxNameLength: number
  message: string | null
  onClose: () => void
  onCreateCategory: (name: string) => boolean
  onRenameCategory: (category: Category, name: string) => boolean
  onDeleteCategory: (category: Category) => void
}

export const CategorySettingsModal = ({
  open,
  categories,
  maxNameLength,
  message,
  onClose,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
}: CategorySettingsModalProps) => {
  const [activeTab, setActiveTab] = useState<'create' | 'manage'>('create')
  const [createName, setCreateName] = useState('')
  const [manageSearch, setManageSearch] = useState('')
  const [manageSort, setManageSort] = useState<'created_desc' | 'created_asc' | 'name_asc' | 'name_desc'>(
    'created_asc',
  )
  const [showSystemCategories, setShowSystemCategories] = useState(true)
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({})
  const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<string | null>(null)

  const handleClose = useCallback(() => {
    setActiveTab('create')
    setCreateName('')
    setManageSearch('')
    setManageSort('created_asc')
    setShowSystemCategories(true)
    setRenameDrafts({})
    setPendingDeleteCategoryId(null)
    onClose()
  }, [onClose])

  const renameTargets = useMemo(
    () =>
      categories.reduce<Record<string, string>>((accumulator, category) => {
        accumulator[category.id] = renameDrafts[category.id] ?? category.name
        return accumulator
      }, {}),
    [categories, renameDrafts],
  )

  const visibleManageCategories = useMemo(() => {
    const keyword = manageSearch.trim().toLocaleLowerCase('ko-KR')
    const matches = (category: Category) => category.name.toLocaleLowerCase('ko-KR').includes(keyword)

    const systemCategories = showSystemCategories
      ? categories.filter((category) => category.isSystem).filter(matches)
      : []
    const customCategories = categories.filter((category) => !category.isSystem).filter(matches)

    const sortedCustomCategories = [...customCategories].sort((a, b) => {
      if (manageSort === 'created_desc') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }

      if (manageSort === 'name_asc') {
        return a.name.localeCompare(b.name, 'ko')
      }

      if (manageSort === 'name_desc') {
        return b.name.localeCompare(a.name, 'ko')
      }

      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })

    return [...systemCategories, ...sortedCustomCategories]
  }, [categories, manageSearch, manageSort, showSystemCategories])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [handleClose, open])

  if (!open) {
    return null
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          handleClose()
        }
      }}
    >
      <section className="modal category-settings-modal" role="dialog" aria-modal="true" aria-label="카테고리 설정 모달">
        <header className="category-settings-header">
          <div>
            <h2>카테고리 설정</h2>
            <p>생성, 이름변경, 삭제를 이 화면에서 관리합니다.</p>
          </div>
          <button type="button" onClick={handleClose} aria-label="카테고리 설정 닫기">
            닫기
          </button>
        </header>

        <div className="category-settings-tabs" role="tablist" aria-label="카테고리 설정 탭">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'create'}
            className={activeTab === 'create' ? 'active' : ''}
            onClick={() => setActiveTab('create')}
          >
            생성
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'manage'}
            className={activeTab === 'manage' ? 'active' : ''}
            onClick={() => setActiveTab('manage')}
          >
            관리
          </button>
        </div>

        {activeTab === 'create' ? (
          <form
            className="category-create-form"
            onSubmit={(event) => {
              event.preventDefault()
              const isCreated = onCreateCategory(createName)
              if (isCreated) {
                setCreateName('')
              }
            }}
          >
            <label htmlFor="category-create-input">새 카테고리 이름</label>
            <div>
              <input
                id="category-create-input"
                type="text"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="예: 프론트엔드"
                maxLength={maxNameLength}
              />
              <button type="submit">카테고리 생성</button>
            </div>
          </form>
        ) : (
          <div className="category-manage-panel">
            <div className="category-manage-controls">
              <label htmlFor="category-manage-search">검색</label>
              <input
                id="category-manage-search"
                type="text"
                value={manageSearch}
                onChange={(event) => setManageSearch(event.target.value)}
                placeholder="카테고리 이름 검색"
                maxLength={maxNameLength}
              />
              <label htmlFor="category-manage-sort">정렬</label>
              <select
                id="category-manage-sort"
                value={manageSort}
                onChange={(event) =>
                  setManageSort(event.target.value as 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc')
                }
              >
                <option value="created_asc">생성순</option>
                <option value="created_desc">최신순</option>
                <option value="name_asc">이름 오름차순</option>
                <option value="name_desc">이름 내림차순</option>
              </select>
              <label htmlFor="category-manage-system-toggle" className="category-manage-toggle">
                <input
                  id="category-manage-system-toggle"
                  type="checkbox"
                  checked={showSystemCategories}
                  onChange={(event) => setShowSystemCategories(event.target.checked)}
                />
                시스템 카테고리 표시
              </label>
            </div>

            <div className="category-settings-list" role="list">
              {visibleManageCategories.map((category) => (
                <article key={category.id} className="category-settings-item" role="listitem">
                  <form
                    className="category-rename-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      onRenameCategory(category, renameTargets[category.id] ?? category.name)
                    }}
                  >
                    <label htmlFor={`category-rename-${category.id}`}>{category.name}</label>
                    <input
                      id={`category-rename-${category.id}`}
                      type="text"
                      value={renameTargets[category.id] ?? category.name}
                      onChange={(event) =>
                        setRenameDrafts((current) => ({
                          ...current,
                          [category.id]: event.target.value,
                        }))
                      }
                      maxLength={maxNameLength}
                    />
                    <button type="submit">이름변경</button>
                  </form>

                  <div className="category-delete-zone">
                    {category.isSystem ? (
                      <button type="button" disabled>
                        삭제 불가
                      </button>
                    ) : pendingDeleteCategoryId === category.id ? (
                      <>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => {
                            onDeleteCategory(category)
                            setPendingDeleteCategoryId(null)
                          }}
                        >
                          삭제 확인
                        </button>
                        <button type="button" onClick={() => setPendingDeleteCategoryId(null)}>
                          취소
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setPendingDeleteCategoryId(category.id)}>
                        삭제
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {visibleManageCategories.length === 0 ? (
              <p className="category-manage-empty">조건에 맞는 카테고리가 없습니다.</p>
            ) : null}
          </div>
        )}

        {message ? <p className="category-message category-message-modal">{message}</p> : null}
      </section>
    </div>
  )
}
