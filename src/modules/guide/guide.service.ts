import { Prisma } from "@prisma/client"
import type { NightlyCommitment } from "@prisma/client"
import {
  findGuideContext,
  findCommitment,
  createCommitment,
  updateCommitment,
  listCommitments,
} from "./guide.repository.js"
import {
  effectiveTier,
  shortlist,
  missedStreak,
  SMALLER_AFTER_MISSES,
  type CandidateInput,
  type Candidate,
  type RecentCommitment,
  type Tier,
} from "./guide.rules.js"
import { chooseTonight, heuristicPick, type GuideAiInput } from "./guide.ai.js"
import { completeTaskService } from "../task/task.service.js"
import { logHabitService } from "../habit/habit.service.js"
import { todayKeyInTz, dateFromKey, addUtcDays, utcDayKey, weekdayInTz } from "../../shared/utils/time.util.js"
import { NotFoundError } from "../../shared/utils/errors.util.js"
import type { RespondDto } from "./guide.schema.js"

const LOOKBACK_DAYS = 14
const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

export interface TonightDto {
  date: string
  commitment: NightlyCommitment | null
  // Shown when there is nothing to pick from yet.
  emptyMessage: string | null
  missedNights: number
}

type GuideContext = Awaited<ReturnType<typeof findGuideContext>>

const buildCandidates = (ctx: GuideContext, todayKey: string, now: Date): CandidateInput[] => {
  const areaById = new Map(
    ctx.areas.map((a) => [a.id, { name: a.name, tier: effectiveTier(a.tier as Tier, a.laterUntil, now) }]),
  )
  const today = dateFromKey(todayKey)
  const weekday = WEEKDAY_CODES[today.getUTCDay()]!
  const weekStart = addUtcDays(today, -6)

  const tasks: CandidateInput[] = ctx.tasks.map((t) => {
    const areaId = t.areaId ?? t.goal?.areaId ?? null
    const area = areaId ? areaById.get(areaId) : undefined
    const parkedGoal = t.goal && t.goal.status !== "ACTIVE"
    return {
      sourceType: "TASK",
      sourceId: t.id,
      title: t.title,
      minimumVersion: t.minimumVersion,
      areaId,
      areaName: area?.name ?? null,
      // Tasks without an area still count, at maintain weight; tasks under a
      // parked goal wait with LATER until the goal is active again.
      tier: parkedGoal ? "LATER" : (area?.tier ?? "MAINTAIN"),
      goalId: t.goal?.id ?? null,
      goalTitle: t.goal?.title ?? null,
      goalWhy: t.goal?.why ?? null,
      priority: t.priority,
      dueKey: t.dueDate ? utcDayKey(t.dueDate) : null,
    }
  })

  const habits: CandidateInput[] = ctx.habits
    .filter((h) => {
      const doneKeys = new Set(h.logs.map((l) => utcDayKey(l.date)))
      if (doneKeys.has(todayKey)) return false
      if (h.frequency === "CUSTOM") return h.specificDays.includes(weekday)
      if (h.frequency === "WEEKLY") {
        const doneThisWeek = h.logs.filter((l) => l.date >= weekStart).length
        return doneThisWeek < (h.weeklyTarget ?? 1)
      }
      return true
    })
    .map((h) => {
      const area = areaById.get(h.areaId)
      return {
        sourceType: "HABIT",
        sourceId: h.id,
        title: h.title,
        minimumVersion: h.minimumVersion,
        areaId: h.areaId,
        areaName: area?.name ?? null,
        tier: area?.tier ?? "MAINTAIN",
        goalId: null,
        goalTitle: null,
        goalWhy: null,
      }
    })

  return [...tasks, ...habits]
}

const toRecent = (ctx: GuideContext): RecentCommitment[] =>
  ctx.recent.map((r) => ({ dateKey: utcDayKey(r.date), sourceId: r.sourceId, status: r.status }))

const loadToday = async (userId: string) => {
  const now = new Date()
  const probe = await findGuideContext(userId, addUtcDays(dateFromKey(utcDayKey(now)), -LOOKBACK_DAYS))
  const todayKey = todayKeyInTz(probe.timezone, now)
  return { now, ctx: probe, todayKey, date: dateFromKey(todayKey) }
}

const persistPick = async (
  userId: string,
  date: Date,
  pick: Candidate,
  result: { message: string; why: string; minimum: string; source: string },
  mode: "NORMAL" | "SMALLER",
): Promise<NightlyCommitment> => {
  const data = {
    sourceType: pick.sourceType,
    sourceId: pick.sourceId,
    areaId: pick.areaId,
    goalId: pick.goalId,
    title: pick.title,
    minimum: result.minimum,
    why: result.why,
    message: result.message,
    mode,
    source: result.source,
  }
  try {
    return await createCommitment({ userId, date, ...data })
  } catch (err) {
    // Two devices asking at the same moment: the first write wins, the
    // second reads it back instead of failing.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await findCommitment(userId, date)
      if (existing) return existing
    }
    throw err
  }
}

const EMPTY_MESSAGE =
  "Nothing to pick from yet. Add a goal with one small task, or a habit, and I'll choose tonight's one thing for you."

export const getTonightService = async (userId: string): Promise<TonightDto> => {
  const { now, ctx, todayKey, date } = await loadToday(userId)
  const recent = toRecent(ctx)
  const misses = missedStreak(recent, todayKey)

  const existing = await findCommitment(userId, date)
  if (existing) return { date: todayKey, commitment: existing, emptyMessage: null, missedNights: misses }

  const options = shortlist(buildCandidates(ctx, todayKey, now), todayKey, recent)
  if (options.length === 0) return { date: todayKey, commitment: null, emptyMessage: EMPTY_MESSAGE, missedNights: misses }

  const mode = misses >= SMALLER_AFTER_MISSES ? "SMALLER" : "NORMAL"
  const aiInput: GuideAiInput = {
    options,
    mode,
    misses,
    weekday: weekdayInTz(ctx.timezone, now),
    lastSkipReasons: ctx.recent.map((r) => r.skipReason).filter((r): r is string => !!r).slice(0, 5),
    thisYearGoal: ctx.identity?.thisYearGoal ?? null,
  }
  const result = await chooseTonight(aiInput)
  const commitment = await persistPick(userId, date, options[result.index]!, result, mode)
  return { date: todayKey, commitment, emptyMessage: null, missedNights: misses }
}

// "Not this one": swap tonight's pending pick for the next best option.
// Heuristic only — a swap should feel instant and never cost an AI call.
export const swapTonightService = async (userId: string): Promise<TonightDto> => {
  const { now, ctx, todayKey, date } = await loadToday(userId)
  const current = await findCommitment(userId, date)
  if (!current) return getTonightService(userId)

  const recent = toRecent(ctx)
  const misses = missedStreak(recent, todayKey)
  const options = shortlist(
    buildCandidates(ctx, todayKey, now).filter((c) => c.sourceId !== current.sourceId),
    todayKey,
    recent,
  )
  if (options.length === 0) return { date: todayKey, commitment: current, emptyMessage: null, missedNights: misses }

  const result = heuristicPick({
    options,
    mode: current.mode,
    misses,
    weekday: weekdayInTz(ctx.timezone, now),
    lastSkipReasons: [],
    thisYearGoal: null,
  })
  const pick = options[0]!
  const commitment = await updateCommitment(current.id, {
    sourceType: pick.sourceType,
    sourceId: pick.sourceId,
    areaId: pick.areaId,
    goalId: pick.goalId,
    title: pick.title,
    minimum: result.minimum,
    why: result.why,
    message: result.message,
    source: result.source,
    status: "PENDING",
    skipReason: null,
    respondedAt: null,
  })
  return { date: todayKey, commitment, emptyMessage: null, missedNights: misses }
}

export const respondTonightService = async (userId: string, input: RespondDto): Promise<NightlyCommitment> => {
  const { date } = await loadToday(userId)
  // Answering late (after midnight) still lands on the night it was for.
  const target =
    (input.date ? await findCommitment(userId, dateFromKey(input.date)) : null) ??
    (await findCommitment(userId, date)) ??
    (await findCommitment(userId, addUtcDays(date, -1)))
  if (!target) throw new NotFoundError("No pick to answer yet. Open tonight's one thing first.")

  const updated = await updateCommitment(target.id, {
    status: input.status,
    skipReason: input.status === "SKIPPED" ? (input.reason?.trim() || null) : null,
    respondedAt: new Date(),
  })

  // Doing it counts everywhere else too: a habit gets its log, a task done in
  // full is completed. The minimum on a task keeps it open for next time.
  const firstAnswer = target.status === "PENDING"
  if (firstAnswer && input.status !== "SKIPPED") {
    if (target.sourceType === "HABIT") {
      await logHabitService(target.sourceId, userId, { date: target.date, completed: true }).catch(() => undefined)
    } else if (input.status === "DONE") {
      await completeTaskService(target.sourceId, userId).catch(() => undefined)
    }
  }
  return updated
}

// A save turned into "do it tonight" takes tonight's slot, unless tonight
// was already answered (a finished night is never rewritten).
export const setTonightToTaskService = async (userId: string, taskId: string): Promise<boolean> => {
  const { now, ctx, todayKey, date } = await loadToday(userId)
  const input = buildCandidates(ctx, todayKey, now).find((c) => c.sourceId === taskId)
  if (!input) return false
  const [pick] = shortlist([{ ...input, tier: input.tier === "LATER" ? "MAINTAIN" : input.tier }], todayKey, [], 1)
  if (!pick) return false
  const message = `You saved this, so let's use it. Tonight, just start: ${pick.minimum}`
  const current = await findCommitment(userId, date)
  if (current && current.status !== "PENDING") return false
  if (current) {
    await updateCommitment(current.id, {
      sourceType: pick.sourceType,
      sourceId: pick.sourceId,
      areaId: pick.areaId,
      goalId: pick.goalId,
      title: pick.title,
      minimum: pick.minimum,
      why: pick.why,
      message,
      source: "heuristic",
    })
  } else {
    await persistPick(userId, date, pick, { message, why: pick.why, minimum: pick.minimum, source: "heuristic" }, "NORMAL")
  }
  return true
}

export interface NextDto {
  sourceType: "TASK" | "HABIT"
  sourceId: string
  title: string
  minimum: string
  why: string
}

// "One more?" after tonight's thing is done: the next best option, not
// persisted. Finishing it goes through the normal task/habit endpoints.
export const nextService = async (userId: string): Promise<NextDto | null> => {
  const { now, ctx, todayKey, date } = await loadToday(userId)
  const current = await findCommitment(userId, date)
  const [pick] = shortlist(
    buildCandidates(ctx, todayKey, now).filter((c) => c.sourceId !== current?.sourceId),
    todayKey,
    toRecent(ctx),
    1,
  )
  if (!pick) return null
  return { sourceType: pick.sourceType, sourceId: pick.sourceId, title: pick.title, minimum: pick.minimum, why: pick.why }
}

export interface HistoryDto {
  days: { date: string; title: string; status: string; skipReason: string | null; mode: string }[]
  followThroughDays: number
  answeredDays: number
}

export const historyService = async (userId: string, days: number): Promise<HistoryDto> => {
  const since = addUtcDays(dateFromKey(utcDayKey(new Date())), -days)
  const rows = await listCommitments(userId, since)
  return {
    days: rows.map((r) => ({
      date: utcDayKey(r.date),
      title: r.title,
      status: r.status,
      skipReason: r.skipReason,
      mode: r.mode,
    })),
    followThroughDays: rows.filter((r) => r.status === "DONE" || r.status === "MINIMUM").length,
    answeredDays: rows.filter((r) => r.status !== "PENDING").length,
  }
}
