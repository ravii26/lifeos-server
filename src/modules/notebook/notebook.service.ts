import { NotFoundError } from "../../shared/utils/errors.util.js"
import { findTopicById } from "../topic/topic.repository.js"
import {
  createNotebook,
  findNotebooksByUser,
  countNotebooksByUser,
  findNotebookById,
  updateNotebook,
  deleteNotebook,
} from "./notebook.repository.js"
import { getPagination, paginatedResponse } from "../../shared/utils/pagination.util.js"
import type {
  CreateNotebookDto,
  UpdateNotebookDto,
  ListNotebooksDto,
} from "./notebook.schema.js"
import type { NotebookDto } from "./notebook.dto.js"

const getOwnedNotebook = async (id: string, userId: string) => {
  const notebook = await findNotebookById(id, userId)
  if (!notebook) throw new NotFoundError("Notebook not found")
  return notebook
}

const assertTopicOwned = async (topicId: string, userId: string) => {
  const topic = await findTopicById(topicId, userId)
  if (!topic) throw new NotFoundError("Topic not found")
}

export const createNotebookService = async (
  userId: string,
  input: CreateNotebookDto,
): Promise<NotebookDto> => {
  await assertTopicOwned(input.topicId, userId)

  return createNotebook({
    userId,
    topicId: input.topicId,
    title: input.title,
    description: input.description ?? null,
    tags: input.tags ?? [],
  })
}

export const listNotebooksService = async (
  userId: string,
  filters: ListNotebooksDto,
): Promise<NotebookDto[] | ReturnType<typeof paginatedResponse>> => {
  const where = {
    ...(filters.topicId && { topicId: filters.topicId }),
  }

  if (filters.page || filters.limit) {
    const params = getPagination(filters.page, filters.limit)
    const [items, total] = await Promise.all([
      findNotebooksByUser(userId, where, params.skip, params.limit),
      countNotebooksByUser(userId, where),
    ])
    return paginatedResponse(items, total, params)
  }

  return findNotebooksByUser(userId, where)
}

export const getNotebookService = (id: string, userId: string): Promise<NotebookDto> => {
  return getOwnedNotebook(id, userId)
}

export const updateNotebookService = async (
  id: string,
  userId: string,
  input: UpdateNotebookDto,
): Promise<NotebookDto> => {
  await getOwnedNotebook(id, userId)
  await updateNotebook(id, userId, input)
  return getOwnedNotebook(id, userId)
}

export const deleteNotebookService = async (id: string, userId: string): Promise<void> => {
  await getOwnedNotebook(id, userId)
  await deleteNotebook(id, userId)
}
