import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createLink = (data: Prisma.EntityLinkUncheckedCreateInput) => {
  return prisma.entityLink.create({ data })
}

export const findLinkById = (id: string, userId: string) => {
  return prisma.entityLink.findFirst({ where: { id, userId } })
}

// Every link touching an entity, in either direction. Optionally filtered by role.
export const findLinksForEntity = (
  userId: string,
  type: Prisma.EnumEntityTypeFilter["equals"],
  id: string,
  role?: Prisma.EntityLinkWhereInput["role"],
) => {
  return prisma.entityLink.findMany({
    where: {
      userId,
      ...(role ? { role } : {}),
      OR: [
        { fromType: type, fromId: id },
        { toType: type, toId: id },
      ],
    },
    orderBy: [{ createdAt: "desc" }],
  })
}

export const deleteLink = (id: string, userId: string) => {
  return prisma.entityLink.deleteMany({ where: { id, userId } })
}

// Remove every link touching an entity, in either direction. Called when the
// entity itself is deleted, so no EntityLink row is left pointing at a ghost.
export const deleteLinksForEntity = (
  userId: string,
  type: Prisma.EnumEntityTypeFilter["equals"],
  id: string,
) => {
  return prisma.entityLink.deleteMany({
    where: {
      userId,
      OR: [
        { fromType: type, fromId: id },
        { toType: type, toId: id },
      ],
    },
  })
}
