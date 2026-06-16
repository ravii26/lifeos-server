import prisma from "../../lib/prisma.js"

interface IdentityData {
  personality?: string | null
  values?: string[]
  strengths?: string[]
  weaknesses?: string[]
  purpose?: string | null
  thisYearGoal?: string | null
  bigPicture?: string | null
  lifeVision?: string | null
}

export const findIdentityByUser = (userId: string) => {
  return prisma.identity.findUnique({ where: { userId } })
}

// Upsert: creates the identity on first save, updates it thereafter.
export const upsertIdentity = (userId: string, data: IdentityData) => {
  return prisma.identity.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  })
}
