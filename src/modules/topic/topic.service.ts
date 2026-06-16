import { NotFoundError } from "../../shared/utils/errors.util.js"
import { findAreaById } from "../area/area.repository.js"
import {
  createTopic,
  findTopicsByUser,
  findTopicById,
  updateTopic,
  deleteTopic,
} from "./topic.repository.js"
import type { CreateTopicDto, UpdateTopicDto, ListTopicsDto } from "./topic.schema.js"
import type { TopicDto } from "./topic.dto.js"

const getOwnedTopic = async (id: string, userId: string) => {
  const topic = await findTopicById(id, userId)
  if (!topic) throw new NotFoundError("Topic not found")
  return topic
}

const assertAreaOwned = async (areaId: string, userId: string) => {
  const area = await findAreaById(areaId, userId)
  if (!area) throw new NotFoundError("Area not found")
}

export const createTopicService = async (
  userId: string,
  input: CreateTopicDto,
): Promise<TopicDto> => {
  await assertAreaOwned(input.areaId, userId)

  return createTopic({
    userId,
    areaId: input.areaId,
    title: input.title,
    description: input.description ?? null,
    masteryLevel: input.masteryLevel ?? "BEGINNER",
  })
}

export const listTopicsService = (
  userId: string,
  filters: ListTopicsDto,
): Promise<TopicDto[]> => {
  return findTopicsByUser(userId, {
    ...(filters.areaId && { areaId: filters.areaId }),
    ...(filters.masteryLevel && { masteryLevel: filters.masteryLevel }),
  })
}

export const getTopicService = (id: string, userId: string): Promise<TopicDto> => {
  return getOwnedTopic(id, userId)
}

export const updateTopicService = async (
  id: string,
  userId: string,
  input: UpdateTopicDto,
): Promise<TopicDto> => {
  await getOwnedTopic(id, userId)
  if (input.areaId) await assertAreaOwned(input.areaId, userId)
  return updateTopic(id, input)
}

export const deleteTopicService = async (id: string, userId: string): Promise<void> => {
  await getOwnedTopic(id, userId)
  await deleteTopic(id)
}
