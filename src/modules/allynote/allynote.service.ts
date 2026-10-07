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
