// Response DTO — the user's single Identity record.
export interface IdentityDto {
  id: string
  personality: string | null
  values: string[]
  strengths: string[]
  weaknesses: string[]
  purpose: string | null
  thisYearGoal: string | null
  bigPicture: string | null
  lifeVision: string | null
  createdAt: Date
  updatedAt: Date
}
