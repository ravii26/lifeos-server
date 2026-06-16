import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createTopic = (data: Prisma.TopicUncheckedCreateInput) => {
  return prisma.topic.create({ data })
}

export const findTopicsByUser = (userId: string, filters: Prisma.TopicWhereInput = {}) => {
  return prisma.topic.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
  })
}

export const findTopicById = (id: string, userId: string) => {
  return prisma.topic.findFirst({ where: { id, userId } })
}

export const updateTopic = (id: string, data: Prisma.TopicUpdateInput) => {
  return prisma.topic.update({ where: { id }, data })
}

export const deleteTopic = (id: string) => {
  return prisma.topic.delete({ where: { id } })
}
