import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createResource = (data: Prisma.ResourceUncheckedCreateInput) => {
  return prisma.resource.create({ data })
}

export const findResourcesByUser = (
  userId: string,
  filters: Prisma.ResourceWhereInput = {},
  skip?: number,
  take?: number,
) => {
  return prisma.resource.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  })
}

export const countResourcesByUser = (userId: string, filters: Prisma.ResourceWhereInput = {}) => {
  return prisma.resource.count({ where: { userId, ...filters } })
}

export const findResourceById = (id: string, userId: string) => {
  return prisma.resource.findFirst({ where: { id, userId } })
}

export const updateResource = (
  id: string,
  userId: string,
  data: Prisma.ResourceUpdateInput,
) => {
  return prisma.resource.updateMany({ where: { id, userId }, data })
}

export const deleteResource = (id: string, userId: string) => {
  return prisma.resource.deleteMany({ where: { id, userId } })
}
