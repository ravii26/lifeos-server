import { NotFoundError } from "../../shared/utils/errors.util.js"
import { logBehavior } from "../behavior/behavior.service.js"
import {
  createVaultItem,
  findVaultItemsByUser,
  countVaultItemsByUser,
  findVaultItemById,
  updateVaultItem,
  deleteVaultItem,
  incrementVaultUsed,
  incrementVaultHelpful,
} from "./vault.repository.js"
import { getPagination, paginatedResponse } from "../../shared/utils/pagination.util.js"
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

export const listVaultItemsService = async (
  userId: string,
  filters: ListVaultItemsDto,
): Promise<VaultItemDto[] | ReturnType<typeof paginatedResponse>> => {
  const where = {
    ...(filters.vaultType && { vaultType: filters.vaultType }),
    ...(filters.triggerTag && { triggerTags: { has: filters.triggerTag } }),
  }

  if (filters.page || filters.limit) {
    const params = getPagination(filters.page, filters.limit)
    const [items, total] = await Promise.all([
      findVaultItemsByUser(userId, where, params.skip, params.limit),
      countVaultItemsByUser(userId, where),
    ])
    return paginatedResponse(items, total, params)
  }

  return findVaultItemsByUser(userId, where)
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
  await updateVaultItem(id, userId, input)
  return getOwnedVaultItem(id, userId)
}

export const deleteVaultItemService = async (id: string, userId: string): Promise<void> => {
  await getOwnedVaultItem(id, userId)
  await deleteVaultItem(id, userId)
}

// Records that the item was surfaced/opened — bumps usedCount (B7).
export const markVaultItemUsedService = async (
  id: string,
  userId: string,
): Promise<VaultItemDto> => {
  await getOwnedVaultItem(id, userId)
  await incrementVaultUsed(id, userId)
  logBehavior(userId, "VAULT_ACCESSED", { vaultItemId: id })
  return getOwnedVaultItem(id, userId)
}

// Records that the item genuinely helped — bumps helpfulCount, so the coach can
// resurface what actually works over what's merely recent.
export const markVaultItemHelpfulService = async (
  id: string,
  userId: string,
): Promise<VaultItemDto> => {
  await getOwnedVaultItem(id, userId)
  await incrementVaultHelpful(id, userId)
  return getOwnedVaultItem(id, userId)
}
