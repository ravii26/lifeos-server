/* =====================================================================
   What the brain's buttons do: answering a weekly-target session, taking
   one of the advice choices (smaller, tomorrow, weekend, let go), and
   "busy until". Every change is logged and undoable.
   ===================================================================== */
import type { ActivitySource } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { addUtcDays, dateFromKey } from "../../shared/utils/time.util.js"
import { localToUtc } from "../assistant/assistant.capture.js"
import { nextSaturdayKey } from "./brain.rules.js"
import { getClock } from "./now.service.js"

const DEFAULT_SESSION = 25

// Done / the smallest version / Not now, on a session towards a weekly target.
export const respondProjectService = async (
  userId: string,
  input: { projectId: string; action: "DONE" | "MINIMUM" | "SKIP"; minutes?: number; count?: number; reason?: string },
  source: ActivitySource = "APP",
) => {
  const p = await prisma.project.findFirst({
    where: { id: input.projectId, userId },
    select: { id: true, title: true, weeklyTargetMinutes: true, weeklyTargetCount: true, sessionMinutes: true },
  })
  if (!p) throw new NotFoundError("Project not found")
  if (input.action === "SKIP") {
    const ev = await recordActivity(userId, {
      type: "SKIPPED", itemType: "PROJECT", itemId: p.id, title: p.title, reason: input.reason?.trim() || "not now", source, undo: { kind: "NOOP" },
    })
    return { action: input.action, activityId: ev?.id }
  }
  const counted = !(p.weeklyTargetMinutes && p.weeklyTargetMinutes > 0) && (p.weeklyTargetCount ?? 0) > 0
  const minimum = input.action === "MINIMUM"
  const minutes = counted ? undefined : minimum ? 2 : Math.round(input.minutes ?? p.sessionMinutes ?? DEFAULT_SESSION)
  const count = counted ? (minimum ? 1 : Math.max(1, Math.round(input.count ?? 1))) : undefined
  // Progress is derived from the log, so undoing only marks this event undone.
  const ev = await recordActivity(userId, {
    type: minimum ? "MINIMUM" : "LOGGED", itemType: "PROJECT", itemId: p.id, title: p.title, minutes, value: count, source, undo: { kind: "NOOP" },
  })
  return { action: input.action, activityId: ev?.id }
}

export type AdviceChoice = "SMALLER" | "TOMORROW" | "WEEKEND" | "LET_GO"

const iso = (d: Date | null) => (d ? d.toISOString() : null)

// One of the advice buttons on Now. Returns a one-line receipt.
export const applyAdviceService = async (
  userId: string,
  input: { sourceType: "TASK" | "HABIT" | "PROJECT"; sourceId: string; choice: AdviceChoice },
  source: ActivitySource = "APP",
): Promise<{ message: string; activityId?: string }> => {
  const c = await getClock(userId)
  const tomorrow = addUtcDays(dateFromKey(c.todayKey), 1)
  const saturday = dateFromKey(nextSaturdayKey(c.todayKey))

  if (input.sourceType === "TASK") {
    const t = await prisma.task.findFirst({ where: { id: input.sourceId, userId }, select: { id: true, title: true, sizeMinutes: true, dueDate: true, status: true, archivedAt: true } })
    if (!t) throw new NotFoundError("To-do not found")
    const prev = { sizeMinutes: t.sizeMinutes, dueDate: iso(t.dueDate), status: t.status, archivedAt: iso(t.archivedAt) }
    const data =
      input.choice === "SMALLER" ? { sizeMinutes: 10 }
      : input.choice === "TOMORROW" ? { dueDate: tomorrow }
      : input.choice === "WEEKEND" ? { dueDate: saturday }
      : { status: "CANCELLED" as const, archivedAt: new Date() }
    await prisma.task.update({ where: { id: t.id }, data })
    const message =
      input.choice === "SMALLER" ? `${t.title}: 10 minutes is enough now.`
      : input.choice === "TOMORROW" ? `${t.title} moved to tomorrow.`
      : input.choice === "WEEKEND" ? `${t.title} moved to Saturday.`
      : `Let go of ${t.title}. It's archived, not deleted.`
    const ev = await recordActivity(userId, { type: input.choice === "LET_GO" ? "ARCHIVED" : "UPDATED", itemType: "TASK", itemId: t.id, title: message, source, undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev } })
    return { message, activityId: ev?.id }
  }

  if (input.sourceType === "HABIT") {
    const h = await prisma.habit.findFirst({ where: { id: input.sourceId, userId }, select: { id: true, title: true, targetMinutes: true, frequency: true, specificDays: true, isActive: true, sizes: true } })
    if (!h) throw new NotFoundError("Habit not found")
    const prev = { targetMinutes: h.targetMinutes, frequency: h.frequency, specificDays: h.specificDays, isActive: h.isActive }
    const sizes = Array.isArray(h.sizes) ? (h.sizes as { minutes?: number }[]).map((s) => Number(s.minutes)).filter((m) => m > 0) : []
    const smallest = sizes.length ? Math.min(...sizes) : 2
    if (input.choice === "TOMORROW") {
      // A habit is daily anyway: "tomorrow" is a Not now for today.
      const ev = await recordActivity(userId, { type: "SKIPPED", itemType: "HABIT", itemId: h.id, title: h.title, reason: "tomorrow", source, undo: { kind: "NOOP" } })
      return { message: `${h.title}: tomorrow, then.`, activityId: ev?.id }
    }
    const data =
      input.choice === "SMALLER" ? { targetMinutes: smallest }
      : input.choice === "WEEKEND" ? { frequency: "CUSTOM" as const, specificDays: ["SAT", "SUN"] }
      : { isActive: false }
    await prisma.habit.update({ where: { id: h.id }, data })
    const message =
      input.choice === "SMALLER" ? `${h.title}: ${smallest} minutes counts from now on.`
      : input.choice === "WEEKEND" ? `${h.title} is a weekend habit now.`
      : `Let go of ${h.title}. You can bring it back anytime.`
    const ev = await recordActivity(userId, { type: input.choice === "LET_GO" ? "ARCHIVED" : "UPDATED", itemType: "HABIT", itemId: h.id, title: message, source, undo: { kind: "RESTORE_FIELDS", model: "habit", id: h.id, prev } })
    return { message, activityId: ev?.id }
  }

  const p = await prisma.project.findFirst({ where: { id: input.sourceId, userId }, select: { id: true, title: true, sessionMinutes: true, status: true } })
  if (!p) throw new NotFoundError("Project not found")
  const prev = { sessionMinutes: p.sessionMinutes, status: p.status }
  if (input.choice === "TOMORROW" || input.choice === "WEEKEND") {
    const ev = await recordActivity(userId, { type: "SKIPPED", itemType: "PROJECT", itemId: p.id, title: p.title, reason: input.choice.toLowerCase(), source, undo: { kind: "NOOP" } })
    return { message: input.choice === "TOMORROW" ? `${p.title}: tomorrow, then.` : `${p.title}: the weekend, then.`, activityId: ev?.id }
  }
  const data = input.choice === "SMALLER" ? { sessionMinutes: Math.max(10, Math.round((p.sessionMinutes ?? DEFAULT_SESSION) / 2)) } : { status: "PAUSED" as const }
  await prisma.project.update({ where: { id: p.id }, data })
  const message = input.choice === "SMALLER" ? `${p.title}: ${data.sessionMinutes} minutes at a time now.` : `${p.title} is paused. Nothing is lost; resume it anytime.`
  const ev = await recordActivity(userId, { type: "UPDATED", itemType: "PROJECT", itemId: p.id, title: message, source, undo: { kind: "RESTORE_FIELDS", model: "project", id: p.id, prev } })
  return { message, activityId: ev?.id }
}

// "In a meeting till 4" (HH:mm, today) or null to clear it.
export const setBusyService = async (userId: string, untilHHmm: string | null, source: ActivitySource = "APP") => {
  const c = await getClock(userId)
  const until = untilHHmm ? localToUtc(`${c.todayKey}T${untilHHmm}`, c.tz) : null
  if (untilHHmm && (!until || until.getTime() <= c.now.getTime())) throw new ValidationError("That time has already passed.")
  const prev = await prisma.userSettings.findUnique({ where: { userId }, select: { busyUntil: true } })
  await prisma.userSettings.upsert({ where: { userId }, create: { userId, enabledModules: [], busyUntil: until }, update: { busyUntil: until } })
  const ev = await recordActivity(userId, {
    type: "UPDATED", itemType: "SETTING", title: until ? `Busy until ${untilHHmm}` : "Not busy any more", source,
    undo: { kind: "RESTORE_FIELDS", model: "settings", id: userId, prev: { busyUntil: iso(prev?.busyUntil ?? null) } },
  })
  return { busyUntil: until, activityId: ev?.id }
}
