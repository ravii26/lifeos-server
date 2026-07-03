import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createCapture = (data: Prisma.CaptureUncheckedCreateInput) => {
  return prisma.capture.create({ data })
}

export const findCapturesByUser = (
  userId: string,
  filters: Prisma.CaptureWhereInput = {},
  skip?: number,
  take?: number,
) => {
  return prisma.capture.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  })
}

export const countCapturesByUser = (
  userId: string,
  filters: Prisma.CaptureWhereInput = {},
) => {
  return prisma.capture.count({ where: { userId, ...filters } })
}

export const findCaptureById = (id: string, userId: string) => {
  return prisma.capture.findFirst({ where: { id, userId } })
}

export const updateCapture = (id: string, userId: string, data: Prisma.CaptureUpdateInput) => {
  return prisma.capture.updateMany({ where: { id, userId }, data })
}

export const deleteCapture = (id: string, userId: string) => {
  return prisma.capture.deleteMany({ where: { id, userId } })
}
