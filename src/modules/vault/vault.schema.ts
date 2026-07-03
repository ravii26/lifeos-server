import { z } from "zod"

const vaultType = z.enum(["REFLECTION", "MEMORY", "MOTIVATION", "RECOVERY"])
const mediaType = z.enum(["TEXT", "QUOTE", "VIDEO", "AUDIO", "IMAGE"])

export const createVaultItemSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Content is required"),
  vaultType: vaultType,
  mediaType: mediaType.optional(),
  url: z.string().url().nullable().optional(),
  triggerTags: z.array(z.string().max(50)).optional(),
})

export const updateVaultItemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  vaultType: vaultType.optional(),
  mediaType: mediaType.optional(),
  url: z.string().url().nullable().optional(),
  triggerTags: z.array(z.string().max(50)).optional(),
})

export const listVaultItemsSchema = z.object({
  vaultType: vaultType.optional(),
  triggerTag: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export type CreateVaultItemDto = z.infer<typeof createVaultItemSchema>
export type UpdateVaultItemDto = z.infer<typeof updateVaultItemSchema>
export type ListVaultItemsDto = z.infer<typeof listVaultItemsSchema>
