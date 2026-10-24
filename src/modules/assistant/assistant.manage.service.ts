/* =====================================================================
   Carrying out what assistant.manage.ts recognises (plan 20, ADR 0030).
   All code, no AI. Remove = archive: to-dos get archivedAt, habits
   isActive = false, goals ABANDONED, so every change has Undo and
   "bring back X" works later. Notes already have a restorable delete.
   Every id is looked up by userId; the AI never supplies one.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { recordActivity, undoActivityService } from "../activity/activity.service.js"
import { deleteAllyNoteService } from "../allynote/allynote.service.js"
import {
  BULK_ASK_OVER,
  choiceText,
  findItems,
  kindLabel,
  manageIntent,
  type Item,
  type Kind,
  type ManageIntent,
  type Match,
} from "./assistant.manage.js"
import type { ChatAction, ChatResult } from "./assistant.chat.js"

const MAX_AT_ONCE = 25
const OPEN = ["TODO", "IN_PROGRESS"] as const

const reply = (text: string, actions: ChatAction[] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })

// Options are commands: the phone sends them back exactly as written (not as "Done: …").
const ask = (question: string, options: { id: string; title: string }[]): ChatResult => reply(question, [{ type: "ASK", question, options: options.map((o) => ({ ...o, command: true })) }])

const names = (items: Item[], max = 5) => {
  const shown = items.slice(0, max).map((i) => `"${i.title}"`)
  return items.length > max ? `${shown.join(", ")} and ${items.length - max} more` : shown.join(", ").replace(/, ([^,]*)$/, " and $1")
}

// ---- what the person has right now -----------------------------------------------------

// Open to-dos count as reminders when they have a time. Naming "to-do" finds both.
// Areas are included only when asked for (rename, tier): "remove gym" should not offer the Gym area.
export const loadItems = async (userId: string, kind: Kind | null, withAreas = false): Promise<Item[]> => {
  const out: Item[] = []
  if (!kind || kind === "HABIT") {
    const rows = await prisma.habit.findMany({ where: { userId, isActive: true }, select: { id: true, title: true }, orderBy: { createdAt: "desc" } })
    out.push(...rows.map((r) => ({ id: r.id, kind: "HABIT" as const, title: r.title })))
  }
  if (!kind || kind === "TASK" || kind === "REMINDER") {
    const rows = await prisma.task.findMany({
      where: { userId, status: { in: [...OPEN] }, archivedAt: null },
      select: { id: true, title: true, remindAt: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    })
    for (const r of rows) {
      const k: Kind = r.remindAt ? "REMINDER" : "TASK"
      if (!kind || kind === "TASK" || kind === k) out.push({ id: r.id, kind: k, title: r.title })
    }
  }
  if (!kind || kind === "PROJECT") {
    const rows = await prisma.project.findMany({ where: { userId, status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true, title: true }, orderBy: { createdAt: "desc" } })
    out.push(...rows.map((r) => ({ id: r.id, kind: "PROJECT" as const, title: r.title })))
  }
  if (!kind || kind === "NOTE") {
    const rows = await prisma.allyNote.findMany({ where: { userId }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 200 })
    out.push(...rows.map((r) => ({ id: r.id, kind: "NOTE" as const, title: r.title })))
  }
  if (kind === "AREA" || (!kind && withAreas)) {
    const rows = await prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true }, orderBy: { order: "asc" } })
    out.push(...rows.map((r) => ({ id: r.id, kind: "AREA" as const, title: r.name })))
  }
  return out
}

// ---- doing it ---------------------------------------------------------------------------

type ItemType = "TASK" | "HABIT" | "PROJECT" | "NOTE" | "AREA"
export const itemTypeOf = (k: Kind): ItemType => (k === "REMINDER" ? "TASK" : k)

const removed = (item: Item, detail: string, activityId?: string): ChatAction => ({ type: "ITEM_REMOVED", itemType: itemTypeOf(item.kind) as Exclude<ItemType, "AREA">, id: item.id, title: item.title, detail, activityId })

// Archive or pause one item. Returns null when it's gone or isn't theirs.
const archiveOne = async (userId: string, item: Item, pause: boolean): Promise<ChatAction | null> => {
  if (item.kind === "HABIT") {
    const row = await prisma.habit.findFirst({ where: { id: item.id, userId, isActive: true } })
    if (!row) return null
    await prisma.habit.update({ where: { id: row.id }, data: { isActive: false } })
    const e = await recordActivity(userId, { type: "ARCHIVED", itemType: "HABIT", itemId: row.id, title: row.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "habit", id: row.id, prev: { isActive: true } } })
    return removed(item, pause ? "paused" : "removed", e?.id)
  }
  if (item.kind === "TASK" || item.kind === "REMINDER") {
    const row = await prisma.task.findFirst({ where: { id: item.id, userId, archivedAt: null, status: { in: [...OPEN] } } })
    if (!row) return null
    await prisma.task.update({ where: { id: row.id }, data: { archivedAt: new Date(), status: "CANCELLED" } })
    const e = await recordActivity(userId, { type: "ARCHIVED", itemType: "TASK", itemId: row.id, title: row.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "task", id: row.id, prev: { status: row.status, archivedAt: null } } })
    return removed(item, "removed", e?.id)
  }
  if (item.kind === "PROJECT") {
    const row = await prisma.project.findFirst({ where: { id: item.id, userId, status: { in: ["ACTIVE", "PAUSED"] } } })
    if (!row) return null
    const status = pause ? "PAUSED" : "ABANDONED"
    await prisma.project.update({ where: { id: row.id }, data: { status } })
    const e = await recordActivity(userId, { type: "ARCHIVED", itemType: "PROJECT", itemId: row.id, title: row.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "project", id: row.id, prev: { status: row.status } } })
    return removed(item, pause ? "paused" : "let go (your progress is kept)", e?.id)
  }
  // NOTE: the existing delete keeps everything needed to bring it back.
  const out = await deleteAllyNoteService(userId, item.id, { source: "CHAT" })
  return out ? removed(item, "removed", out.activityId) : null
}

const renameOne = async (userId: string, item: Item, to: string): Promise<ChatAction | null> => {
  const base = { type: "UPDATED" as const, source: "CHAT" as const, itemId: item.id, title: to }
  if (item.kind === "HABIT") {
    const row = await prisma.habit.findFirst({ where: { id: item.id, userId } })
    if (!row) return null
    await prisma.habit.update({ where: { id: row.id }, data: { title: to } })
    const e = await recordActivity(userId, { ...base, itemType: "HABIT", undo: { kind: "RESTORE_FIELDS", model: "habit", id: row.id, prev: { title: row.title } } })
    return { type: "ITEM_UPDATED", itemType: "HABIT", id: row.id, title: to, detail: `renamed from "${row.title}"`, activityId: e?.id }
  }
  if (item.kind === "TASK" || item.kind === "REMINDER") {
    const row = await prisma.task.findFirst({ where: { id: item.id, userId, archivedAt: null } })
    if (!row) return null
    await prisma.task.update({ where: { id: row.id }, data: { title: to } })
    const e = await recordActivity(userId, { ...base, itemType: "TASK", undo: { kind: "RESTORE_FIELDS", model: "task", id: row.id, prev: { title: row.title } } })
    return { type: "ITEM_UPDATED", itemType: "TASK", id: row.id, title: to, detail: `renamed from "${row.title}"`, activityId: e?.id, ...(row.remindAt && { remindAt: row.remindAt.toISOString() }), ...(row.repeatRule && { repeatRule: row.repeatRule }) }
  }
  if (item.kind === "PROJECT") {
    const row = await prisma.project.findFirst({ where: { id: item.id, userId } })
    if (!row) return null
    await prisma.project.update({ where: { id: row.id }, data: { title: to } })
    const e = await recordActivity(userId, { ...base, itemType: "PROJECT", undo: { kind: "RESTORE_FIELDS", model: "project", id: row.id, prev: { title: row.title } } })
    return { type: "ITEM_UPDATED", itemType: "PROJECT", id: row.id, title: to, detail: `renamed from "${row.title}"`, activityId: e?.id }
  }
  if (item.kind === "AREA") {
    const row = await prisma.area.findFirst({ where: { id: item.id, userId, isActive: true } })
    if (!row) return null
    await prisma.area.update({ where: { id: row.id }, data: { name: to } })
    const e = await recordActivity(userId, { ...base, itemType: "SETTING", undo: { kind: "RESTORE_FIELDS", model: "area", id: row.id, prev: { name: row.name } } })
    return { type: "ITEM_UPDATED", itemType: "AREA", id: row.id, title: to, detail: `renamed from "${row.name}"`, activityId: e?.id }
  }
  const row = await prisma.allyNote.findFirst({ where: { id: item.id, userId } })
  if (!row) return null
  await prisma.allyNote.update({ where: { id: row.id }, data: { title: to } })
  const e = await recordActivity(userId, { ...base, itemType: "NOTE", undo: { kind: "RESTORE_FIELDS", model: "allyNote", id: row.id, prev: { title: row.title } } })
  return { type: "ITEM_UPDATED", itemType: "NOTE", id: row.id, title: to, detail: `renamed from "${row.title}"`, activityId: e?.id }
}

// Bring back something removed or paused: undo the logged change, or (for goals and habits
// stopped some other way) switch it back on directly.
export const restoreFromLog = async (userId: string, kind: Kind | null): Promise<(Item & { eventId: string; at: Date })[]> => {
  const since = new Date(Date.now() - 90 * 86_400_000)
  const wanted: string[] | null = kind === "HABIT" ? ["HABIT"] : kind === "PROJECT" ? ["PROJECT"] : kind === "NOTE" ? ["NOTE"] : kind ? ["TASK"] : null
  const events = await prisma.activityEvent.findMany({
    where: { userId, type: { in: ["ARCHIVED", "DELETED"] }, undoneAt: null, at: { gte: since }, ...(wanted && { itemType: { in: wanted as Exclude<ItemType, "AREA">[] } }) },
    orderBy: { at: "desc" },
    take: 200,
  })
  const seen = new Set<string>()
  const out: (Item & { eventId: string; at: Date })[] = []
  for (const e of events) {
    if (!e.undo || !e.title) continue
    const key = `${e.itemType}:${e.itemId ?? e.title}`
    if (seen.has(key)) continue
    seen.add(key)
    const k: Kind = e.itemType === "HABIT" ? "HABIT" : e.itemType === "PROJECT" ? "PROJECT" : e.itemType === "NOTE" ? "NOTE" : "TASK"
    out.push({ id: e.itemId ?? e.id, eventId: e.id, kind: k, title: e.title, at: e.at })
  }
  return out
}

const restoreDirect = async (userId: string, name: string, kind: Kind | null): Promise<Match> => {
  const items: Item[] = []
  if (!kind || kind === "HABIT") {
    const rows = await prisma.habit.findMany({ where: { userId, isActive: false }, select: { id: true, title: true } })
    items.push(...rows.map((r) => ({ id: r.id, kind: "HABIT" as const, title: r.title })))
  }
  if (!kind || kind === "PROJECT") {
    const rows = await prisma.project.findMany({ where: { userId, status: { in: ["PAUSED", "ABANDONED"] } }, select: { id: true, title: true } })
    items.push(...rows.map((r) => ({ id: r.id, kind: "PROJECT" as const, title: r.title })))
  }
  return findItems(name, items)
}

// ---- the entry point ---------------------------------------------------------------------

export const manageChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const intent = manageIntent(text)
  if (!intent) return null
  if (intent.verb === "KEEP") return reply("Okay, nothing changed.")
  // Wiping everything is never done by a chat sentence: it lives in You, with its own confirmation.
  if (!intent.kind && /^(?:my\s+)?(?:account|data|everything|all(?:\s+(?:of\s+)?(?:my\s+)?(?:data|stuff|things))?|profile)$/i.test(intent.name || (intent.all ? "all" : ""))) {
    return reply("I won't delete everything from a chat message. Open You, then Account and data; it asks you to confirm there. I can remove or pause one thing at a time, or all your habits, reminders or goals.")
  }
  if (intent.verb === "RESTORE") return restoreChat(userId, intent)

  const pause = intent.verb === "PAUSE"
  if (intent.kind === "AREA" && intent.verb !== "RENAME") {
    return reply('Areas stay on your list so nothing in them is lost. To spend less time on one, say "move <area> to later" or "make <area> secondary". To rename it: rename area <old> to <new>.')
  }
  const items = await loadItems(userId, intent.kind, intent.verb === "RENAME")

  // "All my habits": a few go straight through; more than a few wait for a yes with the count.
  if (intent.all) {
    if (!intent.kind) return reply('All of what? Say "all my habits", "all my reminders", "all my to-dos", "all my goals" or "all my notes".')
    const label = kindLabel(intent.kind, true)
    const eligible = pause ? items.filter((i) => i.kind !== "NOTE") : items
    if (!eligible.length) return reply(`You don't have any ${label} to ${pause ? "pause" : "remove"}.`)
    if (eligible.length > BULK_ASK_OVER && intent.confirmed !== eligible.length) {
      const word = pause ? "pause" : "remove"
      return ask(`That would ${word} ${eligible.length} ${label}: ${names(eligible)}. ${word[0]!.toUpperCase()}${word.slice(1)} all of them? You can undo it.`, [
        { id: "yes", title: `Yes, ${word} all ${eligible.length} ${label}` },
        { id: "no", title: "No, keep them" },
      ])
    }
    return doMany(userId, eligible.slice(0, MAX_AT_ONCE), pause, label)
  }

  if (intent.verb === "RENAME") return renameChat(userId, intent, items)

  let match = findItems(intent.name, items)
  // "delete note taking habit": the first word was part of the name, not the kind.
  if (match.type === "NONE" && intent.kind && intent.raw && intent.raw !== intent.name) match = findItems(intent.raw, await loadItems(userId, null))
  if (match.type === "NONE") {
    if (!intent.strong) return null // "cancel my meeting" is not about the app's items
    const label = intent.kind ? kindLabel(intent.kind) : "thing"
    const have = intent.kind && items.length ? ` Your ${kindLabel(intent.kind, true)}: ${names(items, 6)}.` : ""
    return reply(`I can't find a ${label} called "${intent.name}".${have}`)
  }
  if (match.type === "MANY") {
    return ask(`"${intent.name}" matches ${match.items.length} things. Which one?`, match.items.map((i) => ({ id: i.id, title: choiceText(intent.verb, i) })))
  }
  const item = match.item
  if (pause && (item.kind === "NOTE" || item.kind === "TASK" || item.kind === "REMINDER")) {
    return reply(`A ${kindLabel(item.kind)} can't be paused. Say "remove ${item.title}" to take it off your list, or "move it to tomorrow" to push it.`)
  }
  const action = await archiveOne(userId, item, pause)
  if (!action) return reply(`"${item.title}" is already gone.`)
  const verbed = pause ? "Paused" : item.kind === "PROJECT" ? "Let go of" : "Removed"
  // Letting a goal go is a decision, not a failure: said once, calmly (plan 16, F26).
  const calm = !pause && item.kind === "PROJECT" ? " Choosing what not to carry is a real decision, and what you already did stays in your history." : ""
  return reply(`${verbed} "${item.title}".${calm} Tap Undo, or say "bring back ${item.title}" any time.`, [action])
}

const doMany = async (userId: string, items: Item[], pause: boolean, label: string): Promise<ChatResult> => {
  const actions: ChatAction[] = []
  const done: Item[] = []
  for (const it of items) {
    const a = await archiveOne(userId, it, pause)
    if (a) {
      actions.push(a)
      done.push(it)
    }
  }
  if (!done.length) return reply(`Nothing to ${pause ? "pause" : "remove"}.`)
  return reply(`${pause ? "Paused" : "Removed"} ${done.length} ${done.length === 1 ? label.replace(/s$/, "") : label}: ${names(done)}. Tap Undo on any of them, or say "bring back" and the name.`, actions)
}

const renameChat = async (userId: string, intent: ManageIntent, items: Item[]): Promise<ChatResult | null> => {
  let match = findItems(intent.name, items)
  if (match.type === "NONE" && intent.kind && intent.raw && intent.raw !== intent.name) match = findItems(intent.raw, await loadItems(userId, null))
  if (match.type === "NONE") return null // "rename" of something that isn't an item: let the AI answer
  if (match.type === "MANY") {
    return reply(`"${intent.name}" matches ${match.items.length} things (${names(match.items)}). Say the full name, like: rename ${kindLabel(match.items[0]!.kind)} "${match.items[0]!.title}" to ${intent.to}.`)
  }
  const old = match.item.title
  const action = await renameOne(userId, match.item, intent.to!)
  return action ? reply(`Renamed "${old}" to "${intent.to}".`, [action]) : reply(`"${old}" is already gone.`)
}

const restoreChat = async (userId: string, intent: ManageIntent): Promise<ChatResult | null> => {
  const logged = await restoreFromLog(userId, intent.kind)
  let match = findItems(intent.name, logged)
  if (match.type === "ONE") {
    const e = logged.find((l) => l.id === match.item.id && l.eventId)!
    await undoActivityService(userId, e.eventId)
    return reply(`Brought back "${e.title}".`, [{ type: "UNDONE", itemType: itemTypeOf(e.kind), id: e.id, title: e.title }])
  }
  if (match.type === "MANY") {
    return ask(`"${intent.name}" matches ${match.items.length} things. Which one?`, match.items.map((i) => ({ id: i.id, title: choiceText("RESTORE", i) })))
  }
  // Stopped some other way (the app, or an older chat): switch it back on.
  const direct = await restoreDirect(userId, intent.name, intent.kind)
  if (direct.type === "ONE") {
    const it = direct.item
    let prevStatus = "PAUSED"
    if (it.kind === "HABIT") {
      await prisma.habit.updateMany({ where: { id: it.id, userId }, data: { isActive: true } })
    } else {
      prevStatus = (await prisma.project.findFirst({ where: { id: it.id, userId }, select: { status: true } }))?.status ?? "PAUSED"
      await prisma.project.updateMany({ where: { id: it.id, userId }, data: { status: "ACTIVE" } })
    }
    const e = await recordActivity(userId, {
      type: "UPDATED", itemType: itemTypeOf(it.kind) as "HABIT" | "PROJECT", itemId: it.id, title: it.title, source: "CHAT",
      undo: it.kind === "HABIT" ? { kind: "RESTORE_FIELDS", model: "habit", id: it.id, prev: { isActive: false } } : { kind: "RESTORE_FIELDS", model: "project", id: it.id, prev: { status: prevStatus } },
    })
    return reply(`Brought back "${it.title}".`, [{ type: "UNDONE", itemType: itemTypeOf(it.kind), id: it.id, title: it.title, activityId: e?.id }])
  }
  if (direct.type === "MANY") {
    return ask(`"${intent.name}" matches ${direct.items.length} things. Which one?`, direct.items.map((i) => ({ id: i.id, title: choiceText("RESTORE", i) })))
  }
  return intent.strong ? reply(`I can't find anything removed or paused that matches "${intent.name}".`) : null
}
