import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createVaultItem = (data: Prisma.VaultItemUncheckedCreateInput) => {
  return prisma.vaultItem.create({ data })
}

export const findVaultItemsByUser = (
  userId: string,
  filters: Prisma.VaultItemWhereInput = {},
  skip?: number,
  take?: number,
) => {
  return prisma.vaultItem.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  })
}

export const countVaultItemsByUser = (
  userId: string,
  filters: Prisma.VaultItemWhereInput = {},
) => {
  return prisma.vaultItem.count({ where: { userId, ...filters } })
}

export const findVaultItemById = (id: string, userId: string) => {
  return prisma.vaultItem.findFirst({ where: { id, userId } })
}

export const updateVaultItem = (
  id: string,
  userId: string,
  data: Prisma.VaultItemUpdateInput,
) => {
  return prisma.vaultItem.updateMany({ where: { id, userId }, data })
}

export const deleteVaultItem = (id: string, userId: string) => {
  return prisma.vaultItem.deleteMany({ where: { id, userId } })
}

// Atomically bump usedCount when an item is surfaced/opened (B7).
export const incrementVaultUsed = (id: string, userId: string) => {
  return prisma.vaultItem.updateMany({
    where: { id, userId },
    data: { usedCount: { increment: 1 } },
  })
}

// Atomically bump helpfulCount when the user marks an item as having helped —
// the signal the coach uses to resurface what actually works.
export const incrementVaultHelpful = (id: string, userId: string) => {
  return prisma.vaultItem.updateMany({
    where: { id, userId },
    data: { helpfulCount: { increment: 1 } },
  })
}
