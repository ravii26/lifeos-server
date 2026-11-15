// Response DTOs — the shapes the server returns to the client.
// Request DTOs live in auth.schema.ts (inferred from the Zod schemas).
export interface UserDto {
  id: string
  email: string
  name: string
  timezone: string
  // A guest account from first run, not saved with an email yet.
  guest?: boolean
}

export interface AuthResponseDto {
  user: UserDto
  token: string
}
