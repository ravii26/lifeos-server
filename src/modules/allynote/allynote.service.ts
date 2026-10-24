import type { NoteTemplate } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { recordActivity, type ActivityOptions } from "../activity/activity.service.js"

export interface CreateAllyNoteInput {
  collection: string
  template: NoteTemplate
  title: string
  items?: string[]
  text?: string | null
  meta?: Record<string, unknown> | null
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
      ...(input.meta ? { meta: input.meta as never } : {}),
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
  // Ticked items (D2): tick / untick by item, or drop the ticked ones / everything.
  tick?: string[]
  untick?: string[]
  clearDone?: boolean
  clearAll?: boolean
  // Structure for one kind of note (a diet plan, a person); replaces the old value.
  meta?: Record<string, unknown>
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
  let done = before.done.filter((d) => items.some((i) => norm(i) === norm(d)))
  if (input.tick?.length) done = [...new Set([...done, ...items.filter((i) => input.tick!.some((t) => norm(t) === norm(i)))])]
  if (input.untick?.length) done = done.filter((d) => !input.untick!.some((u) => norm(u) === norm(d)))
  if (input.clearDone) {
    items = items.filter((i) => !done.includes(i))
    done = []
  }
  if (input.clearAll) {
    items = []
    done = []
  }
  const note = await prisma.allyNote.update({
    where: { id },
    data: {
      collection: input.collection?.slice(0, 80) ?? before.collection,
      title: input.title?.slice(0, 200) ?? before.title,
      items: items.map((i) => i.slice(0, 300)).slice(0, 50),
      done,
      ...(input.meta ? { meta: input.meta as never } : {}),
      text: input.text === undefined ? before.text : input.text?.slice(0, 4000) ?? null,
    },
  })
  const event = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "NOTE",
    itemId: note.id,
    title: note.title,
    source: opts.source,
    undo: { kind: "RESTORE_NOTE", noteId: note.id, collection: before.collection, title: before.title, items: before.items, text: before.text, done: before.done, ...(input.meta ? { meta: before.meta ?? {} } : {}) },
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
    undo: { kind: "RESTORE_ALLY_NOTE", note: { collection: note.collection, template: note.template, title: note.title, items: note.items, text: note.text, done: note.done, meta: note.meta ?? undefined } },
  })
  return { id, activityId: event?.id }
}
