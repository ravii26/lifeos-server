/* =====================================================================
   Seasons: reading the current chapter, starting one, and moving one area
   between places. The caps and maths are in season.rules.ts; this file only
   loads, checks ownership, writes and records Undo.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { ValidationError, NotFoundError } from "../../shared/utils/errors.util.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { upsertSettings } from "../settings/settings.repository.js"
import { getDay } from "../now/now.service.js"
import { projectWeeklyMinutes, habitWeeklyMinutes, taskMinutes } from "../now/pile.rules.js"
import {
  placesOf,
  checkPlaceChange,
  validatePick,
  tiersForPick,
  seasonWeek,
  seasonWeeks,
  seasonOver,
  seasonLine,
  defaultEnd,
  CAPS,
  type AreaLite,
  type Tier,
} from "./season.rules.js"

const loadAreas = async (userId: string): Promise<AreaLite[]> => {
  const rows = await prisma.area.findMany({
    where: { userId, isActive: true },
    select: { id: true, name: true, tier: true, laterUntil: true, order: true },
  })
  return rows.map((r) => ({ ...r, tier: r.tier as Tier }))
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

// What each area asks for in a week (its goals' weekly targets, habits and
// open to-dos, the same sums as the Shrink session) and how much free time
// the week has. Used by setup's "needs about 31 h, you have about 11 h".
const weeklyLoad = async (userId: string) => {
  const OPEN = ["TODO", "IN_PROGRESS"] as const
  const [projects, habits, tasks, days] = await Promise.all([
    prisma.project.findMany({
      where: { userId, status: "ACTIVE" },
      select: { areaId: true, weeklyTargetMinutes: true, weeklyTargetCount: true, sessionMinutes: true, tasks: { where: { status: { in: [...OPEN] }, archivedAt: null }, select: { sizeMinutes: true, targetMinutes: true } } },
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true, isLimit: false, stage: { not: "AUTOMATIC" } },
      select: { areaId: true, frequency: true, weeklyTarget: true, specificDays: true, targetMinutes: true },
    }),
    prisma.task.findMany({
      where: { userId, status: { in: [...OPEN] }, archivedAt: null, remindAt: null, projectId: null },
      select: { areaId: true, sizeMinutes: true, targetMinutes: true },
      take: 300,
    }),
    Promise.all([0, 1, 2, 3, 4, 5, 6].map((d) => getDay(userId, d))),
  ])
  const minutesByArea: Record<string, number> = {}
  const add = (areaId: string | null, m: number) => {
    if (areaId) minutesByArea[areaId] = (minutesByArea[areaId] ?? 0) + m
  }
  for (const p of projects) add(p.areaId, projectWeeklyMinutes({ ...p, openTaskMinutes: p.tasks.reduce((s, t) => s + taskMinutes(t), 0) }))
  for (const h of habits) add(h.areaId, habitWeeklyMinutes(h))
  for (const t of tasks) add(t.areaId, taskMinutes(t))
  return { minutesByArea, freeMinutes: days.flat().reduce((s, b) => s + b.freeMinutes, 0) }
}

// GET /season: the chapter (null before the first one), where every area
// sits, and the small line Now shows under its greeting.
export const getSeasonService = async (userId: string, now = new Date()) => {
  const [settings, areas, load] = await Promise.all([prisma.userSettings.findUnique({ where: { userId } }), loadAreas(userId), weeklyLoad(userId)])
  const places = placesOf(areas, now)
  const all = [...areas].sort((a, b) => a.order - b.order).map((a) => ({ id: a.id, name: a.name, tier: a.tier, weeklyMinutes: load.minutesByArea[a.id] ?? 0 }))
  const base = { places, caps: CAPS, areas: all, freeMinutes: load.freeMinutes }
  const started = settings?.seasonStartedAt ?? null
  if (!settings || !started) return { season: null, ...base }
  const week = seasonWeek(started, now)
  const weeks = seasonWeeks(started, settings.seasonEndsAt)
  return {
    season: {
      number: settings.seasonNumber,
      name: settings.seasonName,
      startedAt: started,
      endsAt: settings.seasonEndsAt,
      endEvent: settings.seasonEndEvent,
      week: Math.min(week, weeks),
      weeks,
      over: seasonOver(settings.seasonEndsAt, now),
      line: seasonLine(settings.seasonName, settings.seasonNumber, week, weeks),
    },
    ...base,
  }
}

export interface StartSeasonInput {
  name?: string | null
  endsAt?: Date | null
  endEvent?: string | null
  focusIds: string[]
  keepGoingIds: string[]
  parked: { areaId: string; until?: Date | null }[]
}

// POST /season: start the next chapter (setup, or after a season review).
// Every area gets its place in one go, and one Undo puts it all back.
export const startSeasonService = async (userId: string, input: StartSeasonInput, now = new Date()) => {
  const problem = validatePick(input)
  if (problem) throw new ValidationError(problem)
  const areas = await loadAreas(userId)
  const owned = new Set(areas.map((a) => a.id))
  const named = [...input.focusIds, ...input.keepGoingIds, ...input.parked.map((p) => p.areaId)]
  if (named.some((id) => !owned.has(id))) throw new NotFoundError("Area not found")

  const settings = await prisma.userSettings.findUnique({ where: { userId } })
  const next = tiersForPick(areas, input)
  const undo: UndoPayload[] = []
  for (const a of areas) {
    const to = next.get(a.id)!
    if (to.tier === a.tier && iso(to.laterUntil) === iso(a.laterUntil)) continue
    undo.push({ kind: "RESTORE_FIELDS", model: "area", id: a.id, prev: { tier: a.tier, laterUntil: iso(a.laterUntil) } })
  }
  undo.push({
    kind: "RESTORE_FIELDS",
    model: "settings",
    id: userId,
    prev: {
      seasonNumber: settings?.seasonNumber ?? 0,
      seasonName: settings?.seasonName ?? null,
      seasonStartedAt: iso(settings?.seasonStartedAt),
      seasonEndsAt: iso(settings?.seasonEndsAt),
      seasonEndEvent: settings?.seasonEndEvent ?? null,
    },
  })

  const number = (settings?.seasonNumber ?? 0) + 1
  await prisma.$transaction([
    ...areas
      .filter((a) => {
        const to = next.get(a.id)!
        return to.tier !== a.tier || iso(to.laterUntil) !== iso(a.laterUntil)
      })
      .map((a) => prisma.area.updateMany({ where: { id: a.id, userId }, data: next.get(a.id)! })),
  ])
  await upsertSettings(userId, {
    seasonNumber: number,
    seasonName: input.name?.trim().slice(0, 60) || null,
    seasonStartedAt: now,
    // Always a date, so "event or date, whichever comes first" holds even when only an event was named.
    seasonEndsAt: input.endsAt ?? defaultEnd(now),
    seasonEndEvent: input.endEvent?.trim().slice(0, 120) || null,
  })
  const event = await recordActivity(userId, {
    type: "CREATED",
    itemType: "SETTING",
    title: `Started ${input.name?.trim() || `Season ${number}`}`,
    source: "APP",
    undo: { kind: "MANY", items: undo },
  })
  return { ...(await getSeasonService(userId, now)), activityId: event?.id ?? null }
}

export interface MoveAreaInput {
  tier: Tier
  laterUntil?: Date | null
  // When the target place is full: the area the person chose to move out,
  // and where it goes (parked by default, with an optional return date).
  swapOutId?: string
  swapOutTier?: Tier
  swapOutUntil?: Date | null
}

// POST /season/areas/:id: move one area ("make English my focus", "park
// money until March"). A full place is answered with what is there, never
// changed silently.
export const moveAreaService = async (userId: string, areaId: string, input: MoveAreaInput, now = new Date()) => {
  const areas = await loadAreas(userId)
  const area = areas.find((a) => a.id === areaId)
  if (!area) throw new NotFoundError("Area not found")
  const out = input.swapOutId ? areas.find((a) => a.id === input.swapOutId) : undefined
  if (input.swapOutId && !out) throw new NotFoundError("Area not found")

  const check = checkPlaceChange(areas, areaId, input.tier, now, out?.id)
  if (!check.ok) return { moved: false as const, full: check.full, current: check.current }

  const laterUntil = input.tier === "LATER" ? (input.laterUntil ?? null) : null
  const outTier: Tier = input.swapOutTier && input.swapOutTier !== input.tier ? input.swapOutTier : "LATER"
  const outUntil = outTier === "LATER" ? (input.swapOutUntil ?? null) : null

  const undo: UndoPayload[] = [{ kind: "RESTORE_FIELDS", model: "area", id: area.id, prev: { tier: area.tier, laterUntil: iso(area.laterUntil) } }]
  if (out) undo.push({ kind: "RESTORE_FIELDS", model: "area", id: out.id, prev: { tier: out.tier, laterUntil: iso(out.laterUntil) } })

  await prisma.$transaction([
    prisma.area.updateMany({ where: { id: area.id, userId }, data: { tier: input.tier, laterUntil } }),
    ...(out ? [prisma.area.updateMany({ where: { id: out.id, userId }, data: { tier: outTier, laterUntil: outUntil } })] : []),
  ])
  const event = await recordActivity(userId, {
    type: input.tier === "LATER" ? "SNOOZED" : "UPDATED",
    itemType: "SETTING",
    itemId: area.id,
    title: out ? `${area.name} in, ${out.name} out` : area.name,
    source: "APP",
    undo: { kind: "MANY", items: undo },
  })
  return { moved: true as const, ...(await getSeasonService(userId, now)), activityId: event?.id ?? null }
}
