// Response DTOs — the shapes the server returns to the client.
// Request DTOs live in auth.schema.ts (inferred from the Zod schemas).
export interface UserDto {
  id: string
  email: string
  name: string
  timezone: string
}

export interface AuthResponseDto {
  user: UserDto
  token: string
}
