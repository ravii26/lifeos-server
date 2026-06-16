import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createProject = (data: Prisma.ProjectUncheckedCreateInput) => {
  return prisma.project.create({ data })
}

export const findProjectsByUser = (userId: string, filters: Prisma.ProjectWhereInput = {}) => {
  return prisma.project.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
  })
}

export const findProjectById = (id: string, userId: string) => {
  return prisma.project.findFirst({ where: { id, userId } })
}

export const updateProject = (id: string, data: Prisma.ProjectUpdateInput) => {
  return prisma.project.update({ where: { id }, data })
}

export const deleteProject = (id: string) => {
  return prisma.project.delete({ where: { id } })
}
