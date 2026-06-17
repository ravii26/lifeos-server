import { NotFoundError } from "../../shared/utils/errors.util.js"
import { logBehavior } from "../behavior/behavior.service.js"
import {
  createVaultItem,
  findVaultItemsByUser,
  findVaultItemById,
  updateVaultItem,
  deleteVaultItem,
  incrementVaultUsed,
} from "./vault.repository.js"
import type {
  CreateVaultItemDto,
  UpdateVaultItemDto,
  ListVaultItemsDto,
} from "./vault.schema.js"
import type { VaultItemDto } from "./vault.dto.js"

const getOwnedVaultItem = async (id: string, userId: string) => {
  const item = await findVaultItemById(id, userId)
  if (!item) throw new NotFoundError("Vault item not found")
  return item
}

export const createVaultItemService = (
  userId: string,
  input: CreateVaultItemDto,
): Promise<VaultItemDto> => {
  return createVaultItem({
    userId,
    title: input.title,
    content: input.content,
    vaultType: input.vaultType,
    mediaType: input.mediaType ?? "TEXT",
    url: input.url ?? null,
    triggerTags: input.triggerTags ?? [],
  })
}

export const listVaultItemsService = (
  userId: string,
  filters: ListVaultItemsDto,
): Promise<VaultItemDto[]> => {
  return findVaultItemsByUser(userId, {
    ...(filters.vaultType && { vaultType: filters.vaultType }),
    ...(filters.triggerTag && { triggerTags: { has: filters.triggerTag } }),
  })
}

export const getVaultItemService = (id: string, userId: string): Promise<VaultItemDto> => {
  return getOwnedVaultItem(id, userId)
}

export const updateVaultItemService = async (
  id: string,
  userId: string,
  input: UpdateVaultItemDto,
): Promise<VaultItemDto> => {
  await getOwnedVaultItem(id, userId)
  return updateVaultItem(id, input)
}

export const deleteVaultItemService = async (id: string, userId: string): Promise<void> => {
  await getOwnedVaultItem(id, userId)
  await deleteVaultItem(id)
}

// Records that the item was surfaced/opened — bumps usedCount (B7).
export const markVaultItemUsedService = async (
  id: string,
  userId: string,
): Promise<VaultItemDto> => {
  await getOwnedVaultItem(id, userId)
  const item = await incrementVaultUsed(id)
  logBehavior(userId, "VAULT_ACCESSED", { vaultItemId: id })
  return item
}
