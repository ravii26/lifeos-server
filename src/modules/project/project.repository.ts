import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createProject = (data: Prisma.ProjectUncheckedCreateInput) => {
  return prisma.project.create({ data })
}

export const findProjectsByUser = (
  userId: string,
  filters: Prisma.ProjectWhereInput = {},
  skip?: number,
  take?: number,
) => {
  return prisma.project.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  })
}

export const countProjectsByUser = (userId: string, filters: Prisma.ProjectWhereInput = {}) => {
  return prisma.project.count({ where: { userId, ...filters } })
}

export const findProjectById = (id: string, userId: string) => {
  return prisma.project.findFirst({ where: { id, userId } })
}

export const updateProject = (
  id: string,
  userId: string,
  data: Prisma.ProjectUpdateInput,
) => {
  return prisma.project.updateMany({ where: { id, userId }, data })
}

export const deleteProject = (id: string, userId: string) => {
  return prisma.project.deleteMany({ where: { id, userId } })
}
