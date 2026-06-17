import { NotFoundError } from "../../shared/utils/errors.util.js"
import { findTopicById } from "../topic/topic.repository.js"
import {
  createResource,
  findResourcesByUser,
  findResourceById,
  updateResource,
  deleteResource,
} from "./resource.repository.js"
import type {
  CreateResourceDto,
  UpdateResourceDto,
  ListResourcesDto,
  UpdateProgressDto,
} from "./resource.schema.js"
import type { ResourceDto } from "./resource.dto.js"

const getOwnedResource = async (id: string, userId: string) => {
  const resource = await findResourceById(id, userId)
  if (!resource) throw new NotFoundError("Resource not found")
  return resource
}

const assertTopicOwned = async (topicId: string, userId: string) => {
  const topic = await findTopicById(topicId, userId)
  if (!topic) throw new NotFoundError("Topic not found")
}

export const createResourceService = async (
  userId: string,
  input: CreateResourceDto,
): Promise<ResourceDto> => {
  await assertTopicOwned(input.topicId, userId)

  return createResource({
    userId,
    topicId: input.topicId,
    title: input.title,
    resourceType: input.resourceType,
    url: input.url ?? null,
    platform: input.platform ?? null,
    status: input.status ?? "NOT_STARTED",
    rating: input.rating ?? null,
    notes: input.notes ?? null,
  })
}

export const listResourcesService = (
  userId: string,
  filters: ListResourcesDto,
): Promise<ResourceDto[]> => {
  return findResourcesByUser(userId, {
    ...(filters.topicId && { topicId: filters.topicId }),
    ...(filters.resourceType && { resourceType: filters.resourceType }),
    ...(filters.status && { status: filters.status }),
  })
}

export const getResourceService = (id: string, userId: string): Promise<ResourceDto> => {
  return getOwnedResource(id, userId)
}

export const updateResourceService = async (
  id: string,
  userId: string,
  input: UpdateResourceDto,
): Promise<ResourceDto> => {
  await getOwnedResource(id, userId)
  return updateResource(id, input)
}

export const deleteResourceService = async (id: string, userId: string): Promise<void> => {
  await getOwnedResource(id, userId)
  await deleteResource(id)
}

// B8 — track lesson/minute progress
export const updateResourceProgressService = async (
  id: string,
  userId: string,
  input: UpdateProgressDto,
): Promise<ResourceDto> => {
  const resource = await getOwnedResource(id, userId)

  const nextLessons = input.lessonsCompleted ?? resource.lessonsCompleted
  const nextTotal = input.totalLessons !== undefined ? input.totalLessons : resource.totalLessons
  const nextMins = input.minutesConsumed !== undefined
    ? resource.minutesConsumed + input.minutesConsumed
    : resource.minutesConsumed

  const shouldComplete =
    input.autoComplete && nextTotal != null && nextLessons >= nextTotal

  return updateResource(id, {
    lessonsCompleted: nextLessons,
    totalLessons: nextTotal,
    minutesConsumed: nextMins,
    ...(shouldComplete && { status: "COMPLETED" }),
  })
}
