import { NotFoundError } from "../../shared/utils/errors.util.js"
import { findTopicById } from "../topic/topic.repository.js"
import { embedSourceInBackground, removeSource } from "../knowledge/knowledge.embed.service.js"
import {
  createResource,
  findResourcesByUser,
  countResourcesByUser,
  findResourceById,
  updateResource,
  deleteResource,
} from "./resource.repository.js"
import { getPagination, paginatedResponse } from "../../shared/utils/pagination.util.js"
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

  const resource = await createResource({
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
  if (resource.notes) {
    embedSourceInBackground(userId, "RESOURCE", resource.id, resource.title, resource.notes)
  }
  return resource
}

export const listResourcesService = async (
  userId: string,
  filters: ListResourcesDto,
): Promise<ResourceDto[] | ReturnType<typeof paginatedResponse>> => {
  const where = {
    ...(filters.topicId && { topicId: filters.topicId }),
    ...(filters.resourceType && { resourceType: filters.resourceType }),
    ...(filters.status && { status: filters.status }),
  }

  if (filters.page || filters.limit) {
    const params = getPagination(filters.page, filters.limit)
    const [items, total] = await Promise.all([
      findResourcesByUser(userId, where, params.skip, params.limit),
      countResourcesByUser(userId, where),
    ])
    return paginatedResponse(items, total, params)
  }

  return findResourcesByUser(userId, where)
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
  await updateResource(id, userId, input)
  const updated = await getOwnedResource(id, userId)
  if (updated.notes) {
    embedSourceInBackground(userId, "RESOURCE", updated.id, updated.title, updated.notes)
  } else {
    await removeSource(userId, "RESOURCE", updated.id)
  }
  return updated
}

export const deleteResourceService = async (id: string, userId: string): Promise<void> => {
  await getOwnedResource(id, userId)
  await removeSource(userId, "RESOURCE", id)
  await deleteResource(id, userId)
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

  await updateResource(id, userId, {
    lessonsCompleted: nextLessons,
    totalLessons: nextTotal,
    minutesConsumed: nextMins,
    ...(shouldComplete && { status: "COMPLETED" }),
  })
  return getOwnedResource(id, userId)
}
