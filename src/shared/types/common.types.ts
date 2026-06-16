export interface AuthTokenPayload {
  id: string
  email: string
}

export interface PaginationParams {
  page: number
  limit: number
  skip: number
}
