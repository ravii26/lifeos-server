import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createCapture = (data: Prisma.CaptureUncheckedCreateInput) => {
  return prisma.capture.create({ data })
}

export const findCapturesByUser = (
  userId: string,
  filters: Prisma.CaptureWhereInput = {},
) => {
  return prisma.capture.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
  })
}

export const findCaptureById = (id: string, userId: string) => {
  return prisma.capture.findFirst({ where: { id, userId } })
}

export const updateCapture = (id: string, data: Prisma.CaptureUpdateInput) => {
  return prisma.capture.update({ where: { id }, data })
}

export const deleteCapture = (id: string) => {
  return prisma.capture.delete({ where: { id } })
}
