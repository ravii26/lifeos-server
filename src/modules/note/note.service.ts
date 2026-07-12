import { NotFoundError } from "../../shared/utils/errors.util.js"
import { findTopicById } from "../topic/topic.repository.js"
import { findNotebookById } from "../notebook/notebook.repository.js"
import { findResourceById } from "../resource/resource.repository.js"
import { embedSourceInBackground, removeSource } from "../knowledge/knowledge.embed.service.js"
import {
  createNote,
  findNotesByUser,
  countNotesByUser,
  findNoteById,
  updateNote,
  deleteNote,
} from "./note.repository.js"
import { getPagination, paginatedResponse } from "../../shared/utils/pagination.util.js"
import type { CreateNoteDto, UpdateNoteDto, ListNotesDto } from "./note.schema.js"
import type { NoteDto } from "./note.dto.js"

const getOwnedNote = async (id: string, userId: string) => {
  const note = await findNoteById(id, userId)
  if (!note) throw new NotFoundError("Note not found")
  return note
}

// Validates any linked parent (topic/notebook/resource) belongs to the user.
const assertLinksOwned = async (
  userId: string,
  links: { topicId?: string; notebookId?: string | null; resourceId?: string | null },
) => {
  if (links.topicId) {
    const topic = await findTopicById(links.topicId, userId)
    if (!topic) throw new NotFoundError("Topic not found")
  }
  if (links.notebookId) {
    const notebook = await findNotebookById(links.notebookId, userId)
    if (!notebook) throw new NotFoundError("Notebook not found")
  }
  if (links.resourceId) {
    const resource = await findResourceById(links.resourceId, userId)
    if (!resource) throw new NotFoundError("Resource not found")
  }
}

export const createNoteService = async (
  userId: string,
  input: CreateNoteDto,
): Promise<NoteDto> => {
  await assertLinksOwned(userId, input)

  const note = await createNote({
    userId,
    topicId: input.topicId,
    notebookId: input.notebookId ?? null,
    resourceId: input.resourceId ?? null,
    title: input.title,
    content: input.content,
    noteType: input.noteType ?? "CONCEPT",
    tags: input.tags ?? [],
  })
  embedSourceInBackground(userId, "NOTE", note.id, note.title, note.content)
  return note
}

export const listNotesService = async (
  userId: string,
  filters: ListNotesDto,
): Promise<NoteDto[] | ReturnType<typeof paginatedResponse>> => {
  const where = {
    ...(filters.topicId && { topicId: filters.topicId }),
    ...(filters.notebookId && { notebookId: filters.notebookId }),
    ...(filters.resourceId && { resourceId: filters.resourceId }),
    ...(filters.noteType && { noteType: filters.noteType }),
  }

  if (filters.page || filters.limit) {
    const params = getPagination(filters.page, filters.limit)
    const [items, total] = await Promise.all([
      findNotesByUser(userId, where, params.skip, params.limit),
      countNotesByUser(userId, where),
    ])
    return paginatedResponse(items, total, params)
  }

  return findNotesByUser(userId, where)
}

export const getNoteService = (id: string, userId: string): Promise<NoteDto> => {
  return getOwnedNote(id, userId)
}

export const updateNoteService = async (
  id: string,
  userId: string,
  input: UpdateNoteDto,
): Promise<NoteDto> => {
  await getOwnedNote(id, userId)
  await assertLinksOwned(userId, input)
  await updateNote(id, userId, input)
  const updated = await getOwnedNote(id, userId)
  embedSourceInBackground(userId, "NOTE", updated.id, updated.title, updated.content)
  return updated
}

export const deleteNoteService = async (id: string, userId: string): Promise<void> => {
  await getOwnedNote(id, userId)
  await removeSource(userId, "NOTE", id)
  await deleteNote(id, userId)
}
