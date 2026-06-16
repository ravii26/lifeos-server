import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createResource = (data: Prisma.ResourceUncheckedCreateInput) => {
  return prisma.resource.create({ data })
}

export const findResourcesByUser = (userId: string, filters: Prisma.ResourceWhereInput = {}) => {
  return prisma.resource.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
  })
}

export const findResourceById = (id: string, userId: string) => {
  return prisma.resource.findFirst({ where: { id, userId } })
}

export const updateResource = (id: string, data: Prisma.ResourceUpdateInput) => {
  return prisma.resource.update({ where: { id }, data })
}

export const deleteResource = (id: string) => {
  return prisma.resource.delete({ where: { id } })
}
