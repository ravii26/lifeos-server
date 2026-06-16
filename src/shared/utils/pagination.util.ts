import { PaginationParams } from "../types/common.types.js"

export const getPagination = (page = 1, limit = 20): PaginationParams => {
  const safePage  = Math.max(1, page)
  const safeLimit = Math.min(100, Math.max(1, limit))
  return {
    page:  safePage,
    limit: safeLimit,
    skip:  (safePage - 1) * safeLimit,
  }
}

export const paginatedResponse = (
  data: unknown[],
  total: number,
  params: PaginationParams
) => ({
  data,
  pagination: {
    total,
    page:       params.page,
    limit:      params.limit,
    totalPages: Math.ceil(total / params.limit),
  },
})
