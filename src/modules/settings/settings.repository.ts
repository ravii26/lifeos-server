import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const findSettings = (userId: string) => {
  return prisma.userSettings.findUnique({ where: { userId } })
}

export const upsertSettings = (userId: string, data: Prisma.UserSettingsUncheckedUpdateInput) => {
  const createData = data as Prisma.UserSettingsUncheckedCreateInput
  return prisma.userSettings.upsert({
    where: { userId },
    // enabledModules has no DB default — if a user's first-ever settings
    // update doesn't happen to touch modules (e.g. they only change vibe),
    // the create branch needs an explicit [] or Prisma throws a null
    // constraint violation instead of creating the row.
    create: { enabledModules: [], ...createData, userId },
    update: data,
  })
}
