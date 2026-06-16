// Response DTO — the shape the server returns for a VaultItem.
export interface VaultItemDto {
  id: string
  title: string
  content: string
  vaultType: string
  mediaType: string
  url: string | null
  triggerTags: string[]
  usedCount: number
  helpfulCount: number
  createdAt: Date
  updatedAt: Date
}
