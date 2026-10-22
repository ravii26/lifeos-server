/* =====================================================================
   Carrying out assistant.screen.ts (plan 20, M4, ADR 0033). All code, no
   AI. Every change reuses what the screens call (respondNowService,
   respondProjectService, moveTasksToLaterService, markPrepDoneService),
   so chat and the buttons can never disagree, and each has Undo.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { capacityTodayService, getNowService, markPrepDoneService, moveTasksToLaterService } from "../now/now.service.js"
import { respondNowService } from "../now/plan.service.js"
import { respondProjectService } from "../now/brain.actions.js"
import { ACCOUNT_TEXT, screenIntent, type ScreenIntent } from "./assistant.screen.js"
import { findItems, quoted, readTarget, type Item } from "./assistant.manage.js"
import { loadItems } from "./assistant.manage.service.js"
import type { ChatAction, ChatResult } from "./assistant.chat.js"

const reply = (text: string, actions: ChatAction[] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })
const ask = (question: string, options: { id: string; title: string }[]): ChatResult => reply(question, [{ type: "ASK", question, options: options.map((o) => ({ ...o, command: true })) }])

type Target = { sourceType: "TASK" | "HABIT" | "PROJECT"; sourceId: string; title: string }

const answer = async (userId: string, t: Target, action: "DONE" | "MINIMUM" | "SKIP", reason?: string): Promise<string | undefined> => {
  if (t.sourceType === "PROJECT") return (await respondProjectService(userId, { projectId: t.sourceId, action, reason }, "CHAT")).activityId
  return (await respondNowService(userId, { sourceType: t.sourceType, sourceId: t.sourceId, action, reason }, "CHAT")).activityId
}

// The thing the card on Now is showing.
const topPick = async (userId: string, smallest = false): Promise<{ target: Target | null; message: string }> => {
  const now = await getNowService(userId, { smallest })
  const o = now.options[0]
  return { target: o ? { sourceType: o.sourceType, sourceId: o.sourceId, title: o.title } : null, message: now.message }
}

const touched = (t: Target, text: string, activityId?: string): ChatAction => ({ type: "ITEM_UPDATED", itemType: t.sourceType, id: t.sourceId, title: t.title, detail: text, activityId })

// A habit or to-do the person named ("gym", "passport").
const resolveNamed = async (userId: string, raw: string, verb: "Skip" | "Count"): Promise<{ target?: Target; ask?: ChatResult }> => {
  const t = readTarget(raw)
  const pool = (await loadItems(userId, t.kind && t.kind !== "AREA" ? t.kind : null)).filter((i) => i.kind === "HABIT" || i.kind === "TASK" || i.kind === "REMINDER")
  const match = findItems(t.name, pool)
  if (match.type === "NONE") return {}
  if (match.type === "MANY") {
    const word = (i: Item) => (i.kind === "HABIT" ? "habit" : i.kind === "REMINDER" ? "reminder" : "to-do")
    return { ask: ask(`"${t.name}" matches ${match.items.length} things. Which one?`, match.items.map((i) => ({ id: i.id, title: `${verb === "Skip" ? "Skip" : "Count the minimum of"} ${word(i)}: ${quoted(i.title)}` }))) }
  }
  const i = match.item
  return { target: { sourceType: i.kind === "HABIT" ? "HABIT" : "TASK", sourceId: i.id, title: i.title } }
}

// "I prepped the oats": the prep step of a habit, matched by what the prep says or the habit's name.
const prepDone = async (userId: string, what: string): Promise<ChatResult | null> => {
  const habits = await prisma.habit.findMany({ where: { userId, isActive: true, prepareAhead: { not: null } }, select: { id: true, title: true, prepareAhead: true } })
  if (!habits.length) return null
  const items: Item[] = habits.map((h) => ({ id: h.id, kind: "HABIT", title: `${h.prepareAhead} ${h.title}` }))
  const match = what ? findItems(what, items) : habits.length === 1 ? { type: "ONE" as const, item: items[0]! } : { type: "NONE" as const }
  if (match.type !== "ONE") return null
  const h = habits.find((x) => x.id === match.item.id)!
  const e = await markPrepDoneService(userId, h.id, "CHAT")
  return reply(`Marked tonight's prep done: ${h.prepareAhead}.`, [{ type: "ITEM_UPDATED", itemType: "HABIT", id: h.id, title: h.prepareAhead ?? h.title, detail: "prep done", activityId: e?.id }])
}

const makePrivate = async (userId: string, what: string, value: boolean): Promise<ChatResult | null> => {
  const rows = await prisma.memory.findMany({ where: { userId }, select: { id: true, content: true, sensitive: true }, take: 300 })
  const match = findItems(what, rows.map((r) => ({ id: r.id, kind: "NOTE" as const, title: r.content })))
  if (match.type === "NONE") return null
  if (match.type === "MANY") return reply(`That matches ${match.items.length} things I remember. Say a bit more, like the full sentence.`)
  const row = rows.find((r) => r.id === match.item.id)!
  if (row.sensitive === value) return reply(value ? "That one is already private." : "That one isn't private.")
  await prisma.memory.update({ where: { id: row.id }, data: { sensitive: value } })
  const e = await recordActivity(userId, { type: "UPDATED", itemType: "MEMORY", itemId: row.id, title: row.content.slice(0, 80), source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "memory", id: row.id, prev: { sensitive: row.sensitive } } })
  return reply(value ? `Marked private: "${row.content}". I won't bring it up unless you do.` : `No longer private: "${row.content}".`, [
    { type: "ITEM_UPDATED", itemType: "MEMORY", id: row.id, title: row.content.slice(0, 80), detail: value ? "marked private" : "no longer private", activityId: e?.id },
  ])
}

const run = async (userId: string, i: ScreenIntent): Promise<ChatResult | null> => {
  switch (i.kind) {
    case "ACCOUNT":
      return reply(ACCOUNT_TEXT[i.what])

    case "SHELF_POINTER":
      return reply(ACCOUNT_TEXT.SHELF)

    case "LOW_ENERGY":
      return reply(i.on ? "Okay. Only the smallest version of everything until tomorrow." : "Okay. Back to your normal plan.", [{ type: "LOW_ENERGY", on: i.on, kind: i.on ? "ON" : "OFF", title: "Low energy today" }])

    case "SMALLER": {
      const now = await getNowService(userId, { smallest: true })
      return reply(now.message, [{ type: "NOW_PICK", kind: now.kind, options: now.options.map((o) => ({ id: o.sourceId, sourceType: o.sourceType, title: o.title, minutes: o.minutes, smaller: o.smaller, minimum: o.minimum })) }])
    }

    case "MOVE_EXTRA": {
      const cap = await capacityTodayService(userId)
      if (!cap.over || !cap.move.length) return reply("Nothing extra: what's planned for today fits.")
      const moved = await moveTasksToLaterService(userId, cap.move, "CHAT")
      const names = cap.move.map((id) => `"${cap.titles[id] ?? ""}"`).slice(0, 4).join(", ")
      return reply(`Moved ${moved.moved} to later: ${names}${cap.move.length > 4 ? " and more" : ""}. They're still on your list.`, [
        { type: "ITEM_UPDATED", itemType: "TASK", id: cap.move[0]!, title: `${moved.moved} to-dos`, detail: "moved to later", activityId: moved.activityId },
      ])
    }

    case "PREP":
      return prepDone(userId, i.what)

    case "PRIVATE":
      return makePrivate(userId, i.what, i.value)

    case "NOT_NOW": {
      if (i.name) {
        const r = await resolveNamed(userId, i.name, "Skip")
        if (r.ask) return r.ask
        if (!r.target) return null // "skip the intro" may not be about the app
        const id = await answer(userId, r.target, "SKIP", "skipped by chat")
        return reply(`Okay, "${r.target.title}" can wait. Nothing is lost.`, [touched(r.target, "skipped for today", id)])
      }
      const { target } = await topPick(userId)
      if (!target) return reply("Nothing is waiting on you right now.")
      const id = await answer(userId, target, "SKIP", "not now")
      const next = await topPick(userId)
      return reply(`Okay, "${target.title}" can wait.${next.target ? ` Next up: ${next.target.title}.` : ""}`, [touched(target, "not now", id)])
    }

    case "MINIMUM": {
      let target: Target | null = null
      if (i.name) {
        const r = await resolveNamed(userId, i.name, "Count")
        if (r.ask) return r.ask
        if (!r.target) return null
        target = r.target
      } else {
        target = (await topPick(userId)).target
        if (!target) return reply("Nothing is waiting on you right now.")
      }
      const id = await answer(userId, target, "MINIMUM")
      return reply(`Counted: ${i.minutes ? `${i.minutes} minutes of` : "the smallest version of"} "${target.title}". A small one still counts.`, [touched(target, i.minutes ? `${i.minutes} min counted` : "smallest version counted", id)])
    }
  }
}

export const screenChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const intent = screenIntent(text)
  return intent ? run(userId, intent) : null
}
