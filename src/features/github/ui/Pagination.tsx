type PaginationProps = {
  currentPage: number
  totalPages: number
  onChangePage: (page: number) => void
}

export const Pagination = ({ currentPage, totalPages, onChangePage }: PaginationProps) => {
  if (totalPages <= 1) {
    return null
  }

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1)

  return (
    <nav className="pagination" aria-label="저장소 페이지네이션">
      <button
        type="button"
        className="btn btn-secondary btn-pill"
        onClick={() => onChangePage(currentPage - 1)}
        disabled={currentPage <= 1}
      >
        이전
      </button>
      {pages.map((page) => (
        <button
          key={page}
          type="button"
          className={`btn btn-secondary btn-pill ${page === currentPage ? 'is-active active' : ''}`}
          onClick={() => onChangePage(page)}
          aria-current={page === currentPage ? 'page' : undefined}
        >
          {page}
        </button>
      ))}
      <button
        type="button"
        className="btn btn-secondary btn-pill"
        onClick={() => onChangePage(currentPage + 1)}
        disabled={currentPage >= totalPages}
      >
        다음
      </button>
    </nav>
  )
}
