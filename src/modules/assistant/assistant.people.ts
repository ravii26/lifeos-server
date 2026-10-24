/* =====================================================================
   People in chat (Phase D slice D5, ADR 0042): "Mom's birthday is 12
   March" (saved, and a reminder every year at 9 am), "Priya's number is
   98765 43210", "call Priya", "WhatsApp Rahul", "what's Priya's number",
   "my people". A person is an INFO note in the collection "People"; the
   phone number and birthday are in its `meta`. All code, no AI, and the
   number is never put in a prompt. The phone opens the call or the
   WhatsApp chat from the CONTACT action's link; Ally does not send
   anything. Names that are not a saved person return null.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { createAllyNoteService, updateAllyNoteService } from "../allynote/allynote.service.js"
import {
  contactUrl,
  dateWords,
  displayName,
  findPerson,
  listReply,
  maskPhone,
  personIntent,
  type PersonIntent,
  type PersonMeta,
  type PersonNote,
} from "../allynote/people.rules.js"
import { recordActivity } from "../activity/activity.service.js"
import { createTaskService } from "../task/task.service.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import { localToUtc } from "./assistant.capture.js"
import type { ChatResult } from "./assistant.chat.js"

const reply = (text: string, actions: ChatResult["actions"] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })

const asMeta = (v: unknown): PersonMeta | null => (v && typeof v === "object" ? (v as PersonMeta) : null)

const loadPeople = async (userId: string): Promise<(PersonNote & { id: string })[]> => {
  const rows = await prisma.allyNote.findMany({ where: { userId, collection: "People" }, select: { id: true, title: true, meta: true }, orderBy: { title: "asc" } })
  return rows.map((r) => ({ id: r.id, title: r.title, meta: asMeta(r.meta) }))
}

const noteAction = (n: { id: string; title: string; items: string[]; activityId?: string }): ChatResult["actions"][number] => ({
  type: "NOTE_UPDATED",
  id: n.id,
  title: n.title,
  items: n.items,
  activityId: n.activityId,
})

// Saves a fact on the person, making them the first time.
const upsert = async (userId: string, people: PersonNote[], name: string, patch: Partial<PersonMeta>) => {
  const found = findPerson(name, people)
  if (found) return updateAllyNoteService(userId, found.id, { meta: { ...(found.meta ?? {}), ...patch } as Record<string, unknown> }, { source: "CHAT" })
  return createAllyNoteService(userId, { collection: "People", template: "INFO", title: displayName(name), meta: patch as Record<string, unknown> }, { source: "CHAT" })
}

const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()
const pad = (n: number): string => String(n).padStart(2, "0")

// 9 am on the birthday: this year if it is still ahead, otherwise next year.
const nextBirthdayAt = (tz: string, month: number, day: number): Date | null => {
  const now = new Date()
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(now))
  for (const y of [year, year + 1]) {
    const at = localToUtc(`${y}-${pad(month)}-${pad(Math.min(day, daysIn(y, month)))}T09:00`, tz)
    if (at && at.getTime() > now.getTime()) return at
  }
  return null
}

const birthday = async (userId: string, intent: Extract<PersonIntent, { kind: "BIRTHDAY" }>, people: PersonNote[]): Promise<ChatResult | null> => {
  const person = await upsert(userId, people, intent.name, { birthday: { month: intent.month, day: intent.day } })
  if (!person) return null
  const tz = await getUserTimezone(userId)
  const at = nextBirthdayAt(tz, intent.month, intent.day)
  const title = `${person.title}'s birthday`
  const actions: ChatResult["actions"] = [noteAction(person)]
  if (at) {
    const existing = await prisma.task.findFirst({ where: { userId, title, repeatRule: "FREQ=YEARLY", archivedAt: null, status: { in: ["TODO", "IN_PROGRESS"] } } })
    if (existing) {
      await prisma.task.update({ where: { id: existing.id }, data: { remindAt: at, dueDate: at } })
      const event = await recordActivity(userId, {
        type: "UPDATED",
        itemType: "TASK",
        itemId: existing.id,
        title,
        source: "CHAT",
        undo: { kind: "RESTORE_FIELDS", model: "task", id: existing.id, prev: { remindAt: existing.remindAt?.toISOString() ?? null, dueDate: existing.dueDate?.toISOString() ?? null } },
      })
      actions.push({ type: "ITEM_UPDATED", itemType: "TASK", id: existing.id, title, detail: `every year on ${dateWords(intent)}`, remindAt: at.toISOString(), repeatRule: "FREQ=YEARLY", activityId: event?.id })
    } else {
      const task = await createTaskService(userId, { title, remindAt: at, dueDate: at, repeatRule: "FREQ=YEARLY", source: "REMINDER" }, { source: "CHAT" })
      actions.push({ type: "REMINDER_SET", id: task.id, text: task.title, remindAt: at.toISOString(), repeatRule: "FREQ=YEARLY", activityId: task.activityId })
    }
  }
  return reply(`Saved ${person.title}'s birthday: ${dateWords(intent)}. ${at ? "I'll remind you every year at 9:00 am on the day." : ""}`.trim(), actions)
}

const phone = async (userId: string, intent: Extract<PersonIntent, { kind: "PHONE" }>, people: PersonNote[]): Promise<ChatResult | null> => {
  const person = await upsert(userId, people, intent.name, { phone: intent.phone })
  if (!person) return null
  return reply(`Saved ${person.title}'s number (${maskPhone(intent.phone)}). Say "call ${person.title}" or "WhatsApp ${person.title}" and I'll open it.`, [noteAction(person)])
}

const contact = async (userId: string, intent: Extract<PersonIntent, { kind: "CONTACT" }>, people: PersonNote[]): Promise<ChatResult | null> => {
  const person = findPerson(intent.name, people)
  if (!person) return null // not a saved person: "call mom tomorrow" or a to-do is for the other handlers
  if (!person.meta?.phone) return reply(`I don't have ${person.title}'s number yet. Say "${person.title}'s number is …" and I'll keep it.`)
  const tz = await getUserTimezone(userId)
  const url = contactUrl(intent.mode, person.meta.phone, tz)
  const verb = intent.mode === "CALL" ? "call" : "WhatsApp"
  return reply(`${person.title}: tap to ${verb}.`, [{ type: "CONTACT", name: person.title, mode: intent.mode, url, title: `${intent.mode === "CALL" ? "Call" : "WhatsApp"} ${person.title}` }])
}

const show = (intent: Extract<PersonIntent, { kind: "SHOW" }>, people: PersonNote[]): ChatResult | null => {
  const person = findPerson(intent.name, people)
  if (!person) return null
  if (intent.what === "PHONE") return reply(person.meta?.phone ? `${person.title}'s number is ${person.meta.phone}.` : `I don't have ${person.title}'s number yet.`)
  if (intent.what === "BIRTHDAY") return reply(person.meta?.birthday ? `${person.title}'s birthday is ${dateWords(person.meta.birthday)}.` : `I don't have ${person.title}'s birthday yet. Say "${person.title}'s birthday is 12 March".`)
  return reply(`${person.title}: ${[person.meta?.birthday ? `birthday ${dateWords(person.meta.birthday)}` : null, person.meta?.phone ? `number ${person.meta.phone}` : null].filter(Boolean).join(", ") || "nothing else saved yet"}.`)
}

export const peopleChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const intent = personIntent(text)
  if (!intent) return null
  const people = await loadPeople(userId)
  switch (intent.kind) {
    case "BIRTHDAY":
      return birthday(userId, intent, people)
    case "PHONE":
      return phone(userId, intent, people)
    case "CONTACT":
      return contact(userId, intent, people)
    case "SHOW":
      return show(intent, people)
    case "LIST":
      return reply(listReply(people))
  }
}
