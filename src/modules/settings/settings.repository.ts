import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const findSettings = (userId: string) => {
  return prisma.userSettings.findUnique({ where: { userId } })
}

export const upsertSettings = (userId: string, data: Prisma.UserSettingsUncheckedUpdateInput) => {
  const createData = data as Prisma.UserSettingsUncheckedCreateInput
  return prisma.userSettings.upsert({
    where: { userId },
    create: { ...createData, userId },
    update: data,
  })
}
