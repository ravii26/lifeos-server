import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createVaultItem = (data: Prisma.VaultItemUncheckedCreateInput) => {
  return prisma.vaultItem.create({ data })
}

export const findVaultItemsByUser = (
  userId: string,
  filters: Prisma.VaultItemWhereInput = {},
) => {
  return prisma.vaultItem.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
  })
}

export const findVaultItemById = (id: string, userId: string) => {
  return prisma.vaultItem.findFirst({ where: { id, userId } })
}

export const updateVaultItem = (id: string, data: Prisma.VaultItemUpdateInput) => {
  return prisma.vaultItem.update({ where: { id }, data })
}

export const deleteVaultItem = (id: string) => {
  return prisma.vaultItem.delete({ where: { id } })
}
