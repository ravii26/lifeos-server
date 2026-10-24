/* =====================================================================
   Lists and shopping in chat (Phase D slice D2, ADR 0039): "add milk to
   shopping", "we're out of eggs", "got the milk", "untick milk", "remove
   milk from shopping", "clear what I got", "show shopping". A list is a
   LIST note; ticking keeps the item and records it in `done`. All code, no
   AI; every change has Undo through the note's own undo. When the words do
   not clearly name one of the person's lists (or shopping / movies /
   books / bucket list), this returns null and the other handlers decide.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { createAllyNoteService, updateAllyNoteService } from "../allynote/allynote.service.js"
import {
  addedReply,
  findListItem,
  listIntent,
  openItems,
  resolveList,
  showReply,
  tickedReply,
  wellKnownList,
  type ListIntent,
  type ListNote,
} from "../allynote/lists.rules.js"
import type { ChatResult } from "./assistant.chat.js"

const reply = (text: string, actions: ChatResult["actions"] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })

const loadLists = async (userId: string): Promise<ListNote[]> => {
  const rows = await prisma.allyNote.findMany({ where: { userId, template: { in: ["LIST", "ROUTINE"] }, NOT: { collection: "Diet" } }, select: { id: true, collection: true, title: true, items: true, done: true }, orderBy: { updatedAt: "desc" } })
  return rows
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim()

const updated = (n: { id: string; title: string; items: string[]; activityId?: string }): ChatResult["actions"] => [
  { type: "NOTE_UPDATED", id: n.id, title: n.title, items: n.items, activityId: n.activityId },
]

const add = async (userId: string, intent: Extract<ListIntent, { kind: "ADD" }>, lists: ListNote[]): Promise<ChatResult | null> => {
  if (!intent.items.length) return null
  const list = resolveList(intent.list, lists)
  if (!list) {
    const known = wellKnownList(intent.list)
    if (!known) return null // not one of their lists: the AI or another handler decides
    const made = await createAllyNoteService(userId, { collection: known.collection, template: "LIST", title: known.title, items: intent.items }, { source: "CHAT" })
    return reply(`Started your ${known.title.toLowerCase()} with ${intent.items.join(", ")}.`, updated({ id: made.id, title: made.title, items: made.items, activityId: made.activityId }))
  }
  const have = new Set(list.items.map(norm))
  const added = intent.items.filter((i) => !have.has(norm(i)))
  const already = intent.items.filter((i) => have.has(norm(i)))
  if (!added.length) return reply(addedReply(list.title, [], already, list.items.length))
  const n = await updateAllyNoteService(userId, list.id, { add: added }, { source: "CHAT" })
  if (!n) return null
  return reply(addedReply(list.title, added, already, n.items.length), updated(n))
}

// Lists to look in for an item: the one named, else all of them (shopping first).
const searchOrder = (name: string | null, lists: ListNote[]): ListNote[] => {
  if (name) {
    const one = resolveList(name, lists)
    return one ? [one] : []
  }
  return [...lists].sort((a, b) => Number(/shopping/i.test(b.collection)) - Number(/shopping/i.test(a.collection)))
}

const tick = async (userId: string, intent: Extract<ListIntent, { kind: "TICK" | "UNTICK" }>, lists: ListNote[]): Promise<ChatResult | null> => {
  const untick = intent.kind === "UNTICK"
  const places = searchOrder(intent.list, lists)
  // The first list that holds the first item decides which list this is about.
  const matches = new Map<string, { list: ListNote; found: string[] }>()
  for (const name of intent.items) {
    for (const list of places) {
      const pool = untick ? list.items.filter((i) => list.done.includes(i)) : openItems(list)
      const hit = findListItem(name, pool)
      if (hit) {
        const cur = matches.get(list.id) ?? { list, found: [] }
        cur.found.push(hit)
        matches.set(list.id, cur)
        break
      }
    }
  }
  if (!matches.size) return null // nothing on their lists by that name: not a list message
  const best = [...matches.values()].sort((a, b) => b.found.length - a.found.length)[0]!
  const n = await updateAllyNoteService(userId, best.list.id, untick ? { untick: best.found } : { tick: best.found }, { source: "CHAT" })
  if (!n) return null
  const text = untick ? `Unticked ${best.found.join(", ")} on your ${n.title.toLowerCase()}.` : tickedReply(n.title, best.found, n.items.filter((i) => !n.done.includes(i)).length)
  return reply(text, updated(n))
}

const remove = async (userId: string, intent: Extract<ListIntent, { kind: "REMOVE" }>, lists: ListNote[]): Promise<ChatResult | null> => {
  const list = resolveList(intent.list, lists)
  if (!list) return null
  const found = intent.items.map((i) => findListItem(i, list.items)).filter((i): i is string => !!i)
  if (!found.length) return null // not on that list: another handler (remove a habit, a task) may own it
  const n = await updateAllyNoteService(userId, list.id, { remove: found }, { source: "CHAT" })
  if (!n) return null
  return reply(`Removed ${found.join(", ")} from your ${n.title.toLowerCase()}. ${n.items.length} left.`, updated(n))
}

const clear = async (userId: string, intent: Extract<ListIntent, { kind: "CLEAR" }>, lists: ListNote[]): Promise<ChatResult | null> => {
  const list = resolveList(intent.list ?? "shopping", lists)
  if (!list) return null
  if (intent.what === "TICKED") {
    const ticked = list.items.filter((i) => list.done.includes(i))
    if (!ticked.length) return reply(`Nothing is ticked off on your ${list.title.toLowerCase()}.`)
    const n = await updateAllyNoteService(userId, list.id, { clearDone: true }, { source: "CHAT" })
    return n ? reply(`Cleared ${ticked.length} ticked ${ticked.length === 1 ? "item" : "items"} from your ${n.title.toLowerCase()}. ${n.items.length} left.`, updated(n)) : null
  }
  if (!list.items.length) return reply(`Your ${list.title.toLowerCase()} is already empty.`)
  const n = await updateAllyNoteService(userId, list.id, { clearAll: true }, { source: "CHAT" })
  return n ? reply(`Emptied your ${n.title.toLowerCase()} (${list.items.length} ${list.items.length === 1 ? "item" : "items"}). Tap Undo to bring it back.`, updated(n)) : null
}

// The day blocks a routine can be shown at on Now ("Gym", "Morning", "Evening"...).
const BLOCKS = ["morning", "commute", "office", "gym", "evening", "night"]

const setRoutine = async (userId: string, intent: Extract<ListIntent, { kind: "SET_ROUTINE" }>, lists: ListNote[]): Promise<ChatResult | null> => {
  if (intent.items.length < 1) return null
  const existing = resolveList(intent.name, lists)
  const name = intent.name.charAt(0).toUpperCase() + intent.name.slice(1)
  const out = existing
    ? await updateAllyNoteService(userId, existing.id, { items: intent.items }, { source: "CHAT" })
    : await createAllyNoteService(userId, { collection: name, template: "ROUTINE", title: `${name} routine`, items: intent.items }, { source: "CHAT" })
  if (!out) return null
  const steps = `${out.items.length} ${out.items.length === 1 ? "step" : "steps"}`
  const where = BLOCKS.includes(intent.name.toLowerCase()) ? `I'll show it on Now at your ${intent.name.toLowerCase()} time.` : `Say "my ${intent.name.toLowerCase()} routine" to see it.`
  return reply(`${existing ? "Updated" : "Saved"} your ${intent.name.toLowerCase()} routine: ${out.items.join(", ")} (${steps}). ${where} Say "done ${out.items[0]!.toLowerCase()}" to tick a step.`, updated(out))
}

const reset = async (userId: string, intent: Extract<ListIntent, { kind: "RESET" }>, lists: ListNote[]): Promise<ChatResult | null> => {
  const list = resolveList(intent.list, lists)
  if (!list) return null
  if (!list.done.length) return reply(`Nothing is ticked on your ${list.title.toLowerCase()}: ${list.items.length} ${list.items.length === 1 ? "step" : "steps"} to do.`)
  const n = await updateAllyNoteService(userId, list.id, { untick: list.done }, { source: "CHAT" })
  return n ? reply(`Reset your ${n.title.toLowerCase()}: ${n.items.length} ${n.items.length === 1 ? "step" : "steps"} to do.`, updated(n)) : null
}

const show = (intent: Extract<ListIntent, { kind: "SHOW" }>, lists: ListNote[]): ChatResult | null => {
  const list = resolveList(intent.list, lists)
  if (!list) return null
  return reply(showReply(list.title, list))
}

export const listChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const intent = listIntent(text)
  if (!intent) return null
  const lists = await loadLists(userId)
  switch (intent.kind) {
    case "ADD":
      return add(userId, intent, lists)
    case "TICK":
    case "UNTICK":
      return tick(userId, intent, lists)
    case "REMOVE":
      return remove(userId, intent, lists)
    case "CLEAR":
      return clear(userId, intent, lists)
    case "SET_ROUTINE":
      return setRoutine(userId, intent, lists)
    case "RESET":
      return reset(userId, intent, lists)
    case "SHOW":
      return show(intent, lists)
  }
}
