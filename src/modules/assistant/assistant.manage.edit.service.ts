/* =====================================================================
   Carrying out assistant.manage.edit.ts (plan 20, M2, ADR 0031).
   All code, no AI. Time and size changes reuse the follow-up code so
   "set the gym habit to 7 am" behaves exactly like "change it to 7 am";
   priority, dates, deadlines, habit days and areas are added here.
   Every change has Undo; every id is looked up by userId.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { createAreaService } from "../area/area.service.js"
import { getClock, type Clock } from "../now/now.service.js"
import { addUtcDays, dateFromKey, localDayStartMs, utcDayKey } from "../../shared/utils/time.util.js"
import { daysAhead, type ChatRef } from "./assistant.followup.js"
import { resize, retime } from "./assistant.followup.service.js"
import { areaIntent, editChoiceText, editIntent, type AreaIntent, type Day, type Edit, type EditIntent, type Level, type Tier } from "./assistant.manage.edit.js"
import { findItems, kindLabel, quoted, type Item, type Kind } from "./assistant.manage.js"
import { loadItems } from "./assistant.manage.service.js"
import type { ChatAction, ChatResult } from "./assistant.chat.js"

const reply = (text: string, actions: ChatAction[] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })
const ask = (question: string, options: { id: string; title: string }[]): ChatResult => reply(question, [{ type: "ASK", question, options: options.map((o) => ({ ...o, command: true })) }])

// Which kinds of thing each change makes sense for.
const ALLOWED: Record<Edit["field"], Kind[]> = {
  TIME: ["HABIT", "TASK", "REMINDER"],
  SIZE: ["HABIT", "TASK", "REMINDER", "PROJECT"],
  PRIORITY: ["TASK", "REMINDER", "PROJECT"],
  WHEN: ["TASK", "REMINDER", "PROJECT", "HABIT"], // a weekday on a habit means "on that day"
  DATE: ["TASK", "REMINDER", "PROJECT"],
  DAYS: ["HABIT"],
}

const LEVEL_LABEL: Record<Level, string> = { LOW: "low", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" }
const DAY_LABEL: Record<Day, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" }

const keyPlus = (key: string, n: number) => utcDayKey(addUtcDays(dateFromKey(key), n))
const pad = (n: number) => String(n).padStart(2, "0")
const at = (key: string, min: number, tz: string) => new Date(localDayStartMs(key, tz) + min * 60_000)
const localKey = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d)
const localMin = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d)
  return (Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0)
}
export const dayLabel = (key: string, todayKey: string) => {
  if (key === todayKey) return "today"
  if (key === keyPlus(todayKey, 1)) return "tomorrow"
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
}
export const timeIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\s?([ap])\.?m\.?/i, " $1m")

// A day and month (year optional): this year, or next year when it has already passed.
const resolveDate = (todayKey: string, d: { day: number; month: number; year: number | null }): string | null => {
  const make = (y: number) => {
    const probe = new Date(Date.UTC(y, d.month - 1, d.day))
    return probe.getUTCMonth() === d.month - 1 && probe.getUTCDate() === d.day ? utcDayKey(probe) : null
  }
  if (d.year) return make(d.year)
  const y = Number(todayKey.slice(0, 4))
  const here = make(y)
  return here && here >= todayKey ? here : make(y + 1)
}

const refOf = (item: Item): ChatRef => ({ type: item.kind === "HABIT" ? "HABIT" : item.kind === "PROJECT" ? "PROJECT" : "TASK", id: item.id, title: item.title })

// ---- the changes that are new here ---------------------------------------------------------------------

const setPriority = async (userId: string, item: Item, level: Level): Promise<ChatResult> => {
  if (item.kind === "PROJECT") {
    const p = await prisma.project.findFirst({ where: { id: item.id, userId }, select: { id: true, title: true, priority: true } })
    if (!p) return reply(`"${item.title}" is gone.`)
    await prisma.project.update({ where: { id: p.id }, data: { priority: level } })
    const e = await recordActivity(userId, { type: "UPDATED", itemType: "PROJECT", itemId: p.id, title: p.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "project", id: p.id, prev: { priority: p.priority } } })
    return reply(`"${p.title}" is now ${LEVEL_LABEL[level]} priority.`, [{ type: "ITEM_UPDATED", itemType: "PROJECT", id: p.id, title: p.title, detail: `${LEVEL_LABEL[level]} priority`, activityId: e?.id }])
  }
  const t = await prisma.task.findFirst({ where: { id: item.id, userId, archivedAt: null }, select: { id: true, title: true, priority: true, remindAt: true, repeatRule: true } })
  if (!t) return reply(`"${item.title}" is gone.`)
  await prisma.task.update({ where: { id: t.id }, data: { priority: level } })
  const e = await recordActivity(userId, { type: "UPDATED", itemType: "TASK", itemId: t.id, title: t.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev: { priority: t.priority } } })
  return reply(`"${t.title}" is now ${LEVEL_LABEL[level]} priority.`, [{ type: "ITEM_UPDATED", itemType: "TASK", id: t.id, title: t.title, detail: `${LEVEL_LABEL[level]} priority`, activityId: e?.id }])
}

// A to-do moves to a day (a reminder keeps its clock time); a goal's deadline moves.
const setDay = async (userId: string, c: Clock, item: Item, key: string): Promise<ChatResult> => {
  if (key < c.todayKey) return reply("That day has already passed. Pick today or a later day.")
  const label = dayLabel(key, c.todayKey)
  if (item.kind === "PROJECT") {
    const p = await prisma.project.findFirst({ where: { id: item.id, userId }, select: { id: true, title: true, deadline: true } })
    if (!p) return reply(`"${item.title}" is gone.`)
    await prisma.project.update({ where: { id: p.id }, data: { deadline: dateFromKey(key) } })
    const e = await recordActivity(userId, { type: "UPDATED", itemType: "PROJECT", itemId: p.id, title: p.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "project", id: p.id, prev: { deadline: p.deadline?.toISOString() ?? null } } })
    return reply(`The deadline for "${p.title}" is now ${label}.`, [{ type: "ITEM_UPDATED", itemType: "PROJECT", id: p.id, title: p.title, detail: `deadline ${label}`, activityId: e?.id }])
  }
  const t = await prisma.task.findFirst({ where: { id: item.id, userId, archivedAt: null }, select: { id: true, title: true, dueDate: true, remindAt: true, windowEnd: true, repeatRule: true } })
  if (!t) return reply(`"${item.title}" is gone.`)
  const prev = { dueDate: t.dueDate?.toISOString() ?? null, remindAt: t.remindAt?.toISOString() ?? null, windowEnd: t.windowEnd?.toISOString() ?? null }
  let data: { dueDate?: Date; remindAt?: Date; windowEnd?: Date | null }
  let detail = label
  if (t.remindAt) {
    const remindAt = at(key, localMin(t.remindAt, c.tz), c.tz)
    const shift = remindAt.getTime() - t.remindAt.getTime()
    data = { remindAt, windowEnd: t.windowEnd ? new Date(t.windowEnd.getTime() + shift) : null }
    detail = `${label} at ${timeIn(remindAt, c.tz)}`
  } else {
    data = { dueDate: dateFromKey(key) }
  }
  const updated = await prisma.task.update({ where: { id: t.id }, data, select: { remindAt: true, windowEnd: true, repeatRule: true } })
  const e = await recordActivity(userId, { type: "UPDATED", itemType: "TASK", itemId: t.id, title: t.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev } })
  return reply(`Moved "${t.title}" to ${detail}.${t.repeatRule ? " It still repeats after that." : ""}`, [
    {
      type: "ITEM_UPDATED", itemType: "TASK", id: t.id, title: t.title, detail: `moved to ${detail}`,
      ...(updated.remindAt && { remindAt: updated.remindAt.toISOString() }),
      ...(updated.windowEnd && { windowEnd: updated.windowEnd.toISOString() }),
      ...(updated.repeatRule && { repeatRule: updated.repeatRule }),
      activityId: e?.id,
    },
  ])
}

const setDays = async (userId: string, item: Item, days: Day[]): Promise<ChatResult> => {
  const h = await prisma.habit.findFirst({ where: { id: item.id, userId }, select: { id: true, title: true, frequency: true, specificDays: true } })
  if (!h) return reply(`"${item.title}" is gone.`)
  await prisma.habit.update({ where: { id: h.id }, data: { frequency: days.length ? "CUSTOM" : "DAILY", specificDays: days } })
  const e = await recordActivity(userId, { type: "UPDATED", itemType: "HABIT", itemId: h.id, title: h.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "habit", id: h.id, prev: { frequency: h.frequency, specificDays: h.specificDays } } })
  const label = days.length ? days.map((d) => DAY_LABEL[d]).join(", ") : "every day"
  return reply(`"${h.title}" is now ${days.length ? `on ${label}` : "every day"}.`, [{ type: "ITEM_UPDATED", itemType: "HABIT", id: h.id, title: h.title, detail: days.length ? `on ${label}` : "every day", activityId: e?.id }])
}

// ---- by name ---------------------------------------------------------------------------------------------

const applyEdit = async (userId: string, item: Item, edit: Edit): Promise<ChatResult> => {
  const c = await getClock(userId)
  switch (edit.field) {
    case "TIME":
      return (await retime(userId, c, refOf(item), edit.hour, edit.minute, edit.ampm)) ?? reply(`"${item.title}" is gone.`)
    case "SIZE":
      return (await resize(userId, refOf(item), edit.minutes)) ?? reply(`"${item.title}" is gone.`)
    case "PRIORITY":
      return setPriority(userId, item, edit.level)
    case "DAYS":
      return setDays(userId, item, edit.days)
    case "DATE": {
      const key = resolveDate(c.todayKey, edit)
      return key ? setDay(userId, c, item, key) : reply("That doesn't look like a real date. Try: set it to 30 Nov.")
    }
    case "WHEN": {
      if (item.kind === "HABIT") {
        // "Set gym habit to monday" means on that day of the week.
        const day = edit.when.kind === "WEEKDAY" ? (["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const)[edit.when.weekday]! : null
        return day ? setDays(userId, item, [day]) : reply('A habit repeats, so give days: "set it to mon wed fri", "weekdays" or "every day".')
      }
      return setDay(userId, c, item, keyPlus(c.todayKey, daysAhead(edit.when, c.weekday)))
    }
  }
}

const editByName = async (userId: string, ei: EditIntent): Promise<ChatResult | null> => {
  const allowed = ALLOWED[ei.edit.field]
  if (ei.kind && !allowed.includes(ei.kind) && !(ei.kind === "TASK" && allowed.includes("REMINDER"))) {
    return reply(`A ${kindLabel(ei.kind)} can't take that change.`)
  }
  const pool = async (kind: Kind | null) => (await loadItems(userId, kind)).filter((i) => allowed.includes(i.kind))
  let match = findItems(ei.name, await pool(ei.kind))
  if (match.type === "NONE" && ei.kind && ei.raw && ei.raw !== ei.name) match = findItems(ei.raw, await pool(null))
  if (match.type === "NONE") {
    // Without a named kind, "set my mind to 5 pm" is probably not about the app at all.
    return ei.named ? reply(`I can't find a ${kindLabel(ei.kind!)} called "${ei.name}".`) : null
  }
  if (match.type === "MANY") {
    return ask(`"${ei.name}" matches ${match.items.length} things. Which one?`, match.items.map((i) => ({ id: i.id, title: editChoiceText(i, ei.edit) })))
  }
  return applyEdit(userId, match.item, ei.edit)
}

// ---- areas ---------------------------------------------------------------------------------------------------------

const COLORS = ["#4b55d6", "#2a9d8f", "#e76f51", "#8a6fdf", "#d4a017", "#3d8bbd"]
const TIER_WORDS: Record<Tier, string> = { MAIN: "main", SECONDARY: "secondary", MAINTAIN: "maintain", LATER: "later" }
const tierChoice = (title: string, tier: Tier) => (tier === "MAIN" ? `Make ${quoted(title)} my main area` : `Make ${quoted(title)} ${TIER_WORDS[tier]}`)

const areaChat = async (userId: string, ai: AreaIntent): Promise<ChatResult | null> => {
  if (ai.op === "CREATE") {
    const existing = await prisma.area.findMany({ where: { userId, isActive: true }, select: { name: true, order: true } })
    if (existing.some((a) => a.name.toLowerCase() === ai.name.toLowerCase())) return reply(`You already have an area called "${ai.name}".`)
    const area = await createAreaService(userId, { name: ai.name, color: COLORS[existing.length % COLORS.length]!, icon: "circle", tier: "MAINTAIN", order: Math.max(0, ...existing.map((a) => a.order)) + 1 })
    const e = await recordActivity(userId, { type: "CREATED", itemType: "SETTING", itemId: area.id, title: area.name, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "area", id: area.id, prev: { isActive: false } } })
    return reply(`Added the area "${area.name}" as a maintain area. Say "make ${area.name.toLowerCase()} my main area" to give it more of your time.`, [
      { type: "ITEM_UPDATED", itemType: "AREA", id: area.id, title: area.name, detail: "added as maintain", activityId: e?.id },
    ])
  }

  const areas = await prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true, tier: true } })
  const items: Item[] = areas.map((a) => ({ id: a.id, kind: "AREA", title: a.name }))
  const match = findItems(ai.name, items)
  if (match.type === "NONE") return null // "move passport to later" is about something else
  if (match.type === "MANY") return ask(`"${ai.name}" matches ${match.items.length} areas. Which one?`, match.items.map((i) => ({ id: i.id, title: tierChoice(i.title, ai.tier) })))

  const area = areas.find((a) => a.id === match.item.id)!
  if (area.tier === ai.tier) return reply(`"${area.name}" is already ${TIER_WORDS[ai.tier]}.`)
  const others = ai.tier === "MAIN" ? areas.filter((a) => a.tier === "MAIN" && a.id !== area.id) : []
  if (others.length && !ai.confirmed) {
    const names = others.map((a) => `"${a.name}"`).join(" and ")
    return ask(`${names} ${others.length > 1 ? "are" : "is"} your main area. Make "${area.name}" main and move ${others.length > 1 ? "them" : "it"} to secondary?`, [
      { id: "yes", title: `Yes, make ${quoted(area.name)} my main area` },
      { id: "no", title: "No, keep it" },
    ])
  }
  await prisma.area.update({ where: { id: area.id }, data: { tier: ai.tier } })
  for (const o of others) await prisma.area.update({ where: { id: o.id }, data: { tier: "SECONDARY" } })
  const e = await recordActivity(userId, {
    type: "UPDATED", itemType: "SETTING", itemId: area.id, title: area.name, source: "CHAT",
    undo: { kind: "MANY", items: [{ kind: "RESTORE_FIELDS", model: "area", id: area.id, prev: { tier: area.tier } }, ...others.map((o) => ({ kind: "RESTORE_FIELDS" as const, model: "area" as const, id: o.id, prev: { tier: o.tier } }))] },
  })
  const moved = others.length ? ` ${others.map((o) => `"${o.name}"`).join(" and ")} moved to secondary.` : ""
  const tail = ai.tier === "LATER" ? " I'll leave it out of suggestions until you move it back." : ""
  return reply(`"${area.name}" is now ${ai.tier === "MAIN" ? "your main area" : TIER_WORDS[ai.tier]}.${moved}${tail}`, [
    { type: "ITEM_UPDATED", itemType: "AREA", id: area.id, title: area.name, detail: ai.tier === "MAIN" ? "now your main area" : `now ${TIER_WORDS[ai.tier]}`, activityId: e?.id },
  ])
}

// The entry point: areas first (they are specific), then edits by name. Null = not ours.
export const editChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const ai = areaIntent(text)
  if (ai) {
    const r = await areaChat(userId, ai)
    if (r) return r
  }
  const ei = editIntent(text)
  return ei ? editByName(userId, ei) : null
}
