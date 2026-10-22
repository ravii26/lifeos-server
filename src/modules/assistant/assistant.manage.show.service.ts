/* =====================================================================
   Building the lists behind "show my habits" (plan 20, M3, ADR 0032).
   Read-only: nothing here changes data. Each row carries its id, title,
   a short detail line and its kind; the phone makes the tap actions
   (remove, pause, set, bring back), which are ordinary chat commands.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { getClock, type Clock } from "../now/now.service.js"
import { utcDayKey } from "../../shared/utils/time.util.js"
import { dayLabel, timeIn } from "./assistant.manage.edit.service.js"
import { kindLabel } from "./assistant.manage.js"
import { restoreFromLog } from "./assistant.manage.service.js"
import { emptyText, listTitle, MAX_ROWS, repeatWord, showIntent, type ShowKind } from "./assistant.manage.show.js"
import type { ChatResult } from "./assistant.chat.js"

type Row = { id: string; title: string; detail: string; kind?: string }

const DAY = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" } as Record<string, string>
const TIER = { MAIN: "Main", SECONDARY: "Secondary", MAINTAIN: "Maintain", LATER: "Later" } as Record<string, string>
const PROJECT_KIND = { MILESTONE: "stages", PRACTICE: "weekly practice", OUTCOME: "a number to move", WORK: "deadline" } as Record<string, string>
const OPEN = ["TODO", "IN_PROGRESS"] as const

const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ")

const rowsFor = async (userId: string, kind: ShowKind, c: Clock): Promise<Row[]> => {
  if (kind === "HABIT") {
    const rows = await prisma.habit.findMany({ where: { userId, isActive: true }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, title: true, frequency: true, specificDays: true, reminderTime: true, stage: true } })
    return rows.map((h) => {
      const days = h.frequency === "CUSTOM" && h.specificDays.length ? h.specificDays.map((d) => DAY[d] ?? d).join(" ") : h.frequency === "WEEKLY" ? "weekly" : "every day"
      const at = h.reminderTime ? timeIn(new Date(`${c.todayKey}T${h.reminderTime}:00Z`), "UTC") : null
      return { id: h.id, title: h.title, detail: join(days, at && `at ${at}`, h.stage === "AUTOMATIC" && "automatic now") }
    })
  }
  if (kind === "TASK") {
    const rows = await prisma.task.findMany({
      where: { userId, status: { in: [...OPEN] }, archivedAt: null, remindAt: null },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
      select: { id: true, title: true, dueDate: true, priority: true },
    })
    return rows.map((t) => ({ id: t.id, title: t.title, detail: join(t.dueDate ? `due ${dayLabel(utcDayKey(t.dueDate), c.todayKey)}` : "no date", (t.priority === "HIGH" || t.priority === "CRITICAL") && `${t.priority.toLowerCase()} priority`) }))
  }
  if (kind === "REMINDER") {
    const rows = await prisma.task.findMany({
      where: { userId, status: { in: [...OPEN] }, archivedAt: null, remindAt: { not: null } },
      orderBy: { remindAt: "asc" },
      take: 200,
      select: { id: true, title: true, remindAt: true, repeatRule: true },
    })
    return rows.map((t) => ({ id: t.id, title: t.title, detail: join(`${dayLabel(new Intl.DateTimeFormat("en-CA", { timeZone: c.tz }).format(t.remindAt!), c.todayKey)} ${timeIn(t.remindAt!, c.tz)}`, repeatWord(t.repeatRule)) }))
  }
  if (kind === "PROJECT") {
    const rows = await prisma.project.findMany({ where: { userId, status: { in: ["ACTIVE", "PAUSED"] } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, title: true, status: true, kind: true, deadline: true } })
    return rows.map((p) => ({ id: p.id, title: p.title, detail: join(p.status === "PAUSED" && "paused", p.deadline ? `by ${dayLabel(utcDayKey(p.deadline), c.todayKey)}` : PROJECT_KIND[p.kind]) }))
  }
  if (kind === "AREA") {
    const rows = await prisma.area.findMany({ where: { userId, isActive: true }, orderBy: [{ order: "asc" }], select: { id: true, name: true, tier: true } })
    const rank: Record<string, number> = { MAIN: 0, SECONDARY: 1, MAINTAIN: 2, LATER: 3 }
    return rows.sort((a, b) => (rank[a.tier] ?? 9) - (rank[b.tier] ?? 9)).map((a) => ({ id: a.id, title: a.name, detail: TIER[a.tier] ?? a.tier }))
  }
  const rows = await prisma.allyNote.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, title: true, collection: true, items: true } })
  return rows.map((n) => ({ id: n.id, title: n.title, detail: join(n.collection, n.items.length ? `${n.items.length} ${n.items.length === 1 ? "item" : "items"}` : null) }))
}

// "show my habits", "what reminders do I have?", "what did I remove?". Null = not ours.
export const showChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const intent = showIntent(text)
  if (!intent) return null
  const c = await getClock(userId)

  if (intent.what === "REMOVED") {
    const logged = (await restoreFromLog(userId, null)).slice(0, 200)
    const rows: Row[] = logged.slice(0, MAX_ROWS).map((l) => ({
      id: l.eventId,
      title: l.title,
      detail: join(kindLabel(l.kind), `removed ${dayLabel(new Intl.DateTimeFormat("en-CA", { timeZone: c.tz }).format(l.at), c.todayKey)}`),
      kind: l.kind,
    }))
    if (!rows.length) return { role: "ASSISTANT", reply: emptyText("REMOVED"), actions: [], usedAi: false }
    const more = logged.length > rows.length ? ` Showing the latest ${rows.length}.` : ""
    return {
      role: "ASSISTANT",
      reply: `${logged.length} ${logged.length === 1 ? "thing" : "things"} you removed or paused. Tap one to bring it back.${more}`,
      actions: [{ type: "LIST", kind: "REMOVED", title: listTitle("REMOVED"), total: logged.length, options: rows }],
      usedAi: false,
    }
  }

  const all = await rowsFor(userId, intent.kind, c)
  if (!all.length) return { role: "ASSISTANT", reply: emptyText(intent.kind), actions: [], usedAi: false }
  const rows = all.slice(0, MAX_ROWS)
  const word = kindLabel(intent.kind, all.length !== 1)
  const more = all.length > rows.length ? ` Showing the first ${rows.length}.` : ""
  return {
    role: "ASSISTANT",
    reply: `You have ${all.length} ${word}.${more} Tap one to change it.`,
    actions: [{ type: "LIST", kind: intent.kind, title: listTitle(intent.kind), total: all.length, options: rows }],
    usedAi: false,
  }
}
