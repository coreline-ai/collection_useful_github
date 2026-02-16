export const paginate = <T>(items: T[], page: number, perPage: number): T[] => {
  if (perPage <= 0 || page <= 0) {
    return []
  }

  const start = (page - 1) * perPage
  return items.slice(start, start + perPage)
}

export const pageCount = (totalItems: number, perPage: number): number => {
  if (perPage <= 0) {
    return 1
  }

  return Math.max(1, Math.ceil(totalItems / perPage))
}
