import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createArea = (data: Prisma.AreaUncheckedCreateInput) => {
  return prisma.area.create({ data })
}

export const findAreasByUser = (userId: string) => {
  return prisma.area.findMany({
    where: { userId },
    orderBy: { order: "asc" },
  })
}

export const findAreaById = (id: string, userId: string) => {
  return prisma.area.findFirst({ where: { id, userId } })
}

export const updateArea = (id: string, data: Prisma.AreaUpdateInput) => {
  return prisma.area.update({ where: { id }, data })
}

export const deleteArea = (id: string) => {
  return prisma.area.delete({ where: { id } })
}

export const getMaxOrder = async (userId: string): Promise<number> => {
  const result = await prisma.area.aggregate({
    where: { userId },
    _max: { order: true },
  })
  return result._max.order ?? -1
}
