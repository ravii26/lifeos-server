import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createTopic = (data: Prisma.TopicUncheckedCreateInput) => {
  return prisma.topic.create({ data })
}

export const findTopicsByUser = (
  userId: string,
  filters: Prisma.TopicWhereInput = {},
  skip?: number,
  take?: number,
) => {
  return prisma.topic.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  })
}

export const countTopicsByUser = (userId: string, filters: Prisma.TopicWhereInput = {}) => {
  return prisma.topic.count({ where: { userId, ...filters } })
}

export const findTopicById = (id: string, userId: string) => {
  return prisma.topic.findFirst({ where: { id, userId } })
}

export const updateTopic = (id: string, userId: string, data: Prisma.TopicUpdateInput) => {
  return prisma.topic.updateMany({ where: { id, userId }, data })
}

export const deleteTopic = (id: string, userId: string) => {
  return prisma.topic.deleteMany({ where: { id, userId } })
}
