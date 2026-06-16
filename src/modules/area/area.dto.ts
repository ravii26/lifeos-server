// Response DTO — the shape the server returns for an Area.
export interface AreaDto {
  id: string
  name: string
  type: string
  color: string
  icon: string
  order: number
  isDefault: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}
