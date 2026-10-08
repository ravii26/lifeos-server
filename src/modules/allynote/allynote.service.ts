import type { NoteTemplate } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { recordActivity, type ActivityOptions } from "../activity/activity.service.js"

export interface CreateAllyNoteInput {
  collection: string
  template: NoteTemplate
  title: string
  items?: string[]
  text?: string | null
}

// "Teach Ally": what the person tells Ally to keep (a breakfast list, a gym
// routine, a playbook, plain info). Search and answering come in step 5.
export const createAllyNoteService = async (userId: string, input: CreateAllyNoteInput, opts: ActivityOptions = {}) => {
  const note = await prisma.allyNote.create({
    data: {
      userId,
      collection: input.collection.slice(0, 80),
      template: input.template,
      title: input.title.slice(0, 200),
      items: (input.items ?? []).map((i) => i.slice(0, 300)).slice(0, 50),
      text: input.text?.slice(0, 4000) ?? null,
    },
  })
  const event = await recordActivity(userId, {
    type: "CREATED",
    itemType: "NOTE",
    itemId: note.id,
    title: note.title,
    source: opts.source,
    undo: { kind: "DELETE_ALLY_NOTE", noteId: note.id },
  })
  return { ...note, activityId: event?.id }
}

export const listAllyNotesService = (userId: string) =>
  prisma.allyNote.findMany({ where: { userId }, orderBy: [{ collection: "asc" }, { updatedAt: "desc" }] })

export interface UpdateAllyNoteInput {
  collection?: string
  title?: string
  items?: string[]
  text?: string | null
  add?: string[]
  remove?: string[]
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim()

// Edits a taught note; "add pancakes" / "remove poha" and full replacements both land here.
export const updateAllyNoteService = async (userId: string, id: string, input: UpdateAllyNoteInput, opts: ActivityOptions = {}) => {
  const before = await prisma.allyNote.findFirst({ where: { id, userId } })
  if (!before) return null
  let items = input.items ?? before.items
  if (input.remove?.length) {
    const gone = new Set(input.remove.map(norm))
    items = items.filter((i) => !gone.has(norm(i)))
  }
  if (input.add?.length) {
    const have = new Set(items.map(norm))
    items = [...items, ...input.add.map((i) => i.trim()).filter((i) => i && !have.has(norm(i)))]
  }
  const note = await prisma.allyNote.update({
    where: { id },
    data: {
      collection: input.collection?.slice(0, 80) ?? before.collection,
      title: input.title?.slice(0, 200) ?? before.title,
      items: items.map((i) => i.slice(0, 300)).slice(0, 50),
      text: input.text === undefined ? before.text : input.text?.slice(0, 4000) ?? null,
    },
  })
  const event = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "NOTE",
    itemId: note.id,
    title: note.title,
    source: opts.source,
    undo: { kind: "RESTORE_NOTE", noteId: note.id, collection: before.collection, title: before.title, items: before.items, text: before.text },
  })
  return { ...note, activityId: event?.id }
}

// A person-initiated delete (the Notes screen asks first). It can still be undone.
export const deleteAllyNoteService = async (userId: string, id: string, opts: ActivityOptions = {}) => {
  const note = await prisma.allyNote.findFirst({ where: { id, userId } })
  if (!note) return null
  await prisma.allyNote.delete({ where: { id } })
  const event = await recordActivity(userId, {
    type: "DELETED",
    itemType: "NOTE",
    itemId: id,
    title: note.title,
    source: opts.source,
    undo: { kind: "RESTORE_ALLY_NOTE", note: { collection: note.collection, template: note.template, title: note.title, items: note.items, text: note.text } },
  })
  return { id, activityId: event?.id }
}
