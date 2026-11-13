/* =====================================================================
   The sleep plan: start it, read it, and the weekly "did you keep your
   wake time?" that moves it on. Each step is written into the person's
   DaySchedule (wake = first block, bedtime = last block), so the agenda,
   Now and the time maths all follow it without knowing it exists.
   ===================================================================== */
import type { Prisma } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { upsertSettings } from "../settings/settings.repository.js"
import { getDay } from "../now/now.service.js"
import { toMin } from "../now/now.rules.js"
import { ladder, nextStep, retimeDay, guidelineNote, MIN_HOURS, MAX_HOURS, KEEP_TO_ADVANCE, type SleepStep } from "./sleep.rules.js"

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

const planOf = (s: { sleepTargetWake: string | null; sleepHours: number | null; sleepFromWake: string | null; sleepStep: number; sleepStepAt: Date | null } | null) => {
  if (!s?.sleepTargetWake || !s.sleepHours || !s.sleepFromWake || s.sleepStep < 1) return null
  const steps = ladder(s.sleepFromWake, s.sleepTargetWake, s.sleepHours)
  const step = Math.min(s.sleepStep, steps.length)
  return { targetWake: s.sleepTargetWake, hours: s.sleepHours, step, steps, current: steps[step - 1]!, done: step === steps.length, stepAt: s.sleepStepAt }
}

export const getSleepPlanService = async (userId: string) => {
  const s = await prisma.userSettings.findUnique({ where: { userId } })
  return { plan: planOf(s), keepToAdvance: KEEP_TO_ADVANCE }
}

// Writes one step's wake and bedtime into all 7 days. Returns the Undo for the days.
const applyStep = async (userId: string, step: SleepStep): Promise<UndoPayload> => {
  const prev = await prisma.daySchedule.findMany({ where: { userId } })
  for (let weekday = 0; weekday < 7; weekday++) {
    const blocks = retimeDay(await getDay(userId, weekday), step.wake, step.sleep)
    await prisma.daySchedule.upsert({
      where: { userId_weekday: { userId, weekday } },
      create: { userId, weekday, blocks: blocks as unknown as Prisma.InputJsonValue },
      update: { blocks: blocks as unknown as Prisma.InputJsonValue },
    })
  }
  return { kind: "RESTORE_SCHEDULE", weekdays: [0, 1, 2, 3, 4, 5, 6], prev: prev.map((p) => ({ weekday: p.weekday, blocks: p.blocks })) }
}

const settingsUndo = (s: { sleepTargetWake: string | null; sleepHours: number | null; sleepFromWake: string | null; sleepStep: number; sleepStepAt: Date | null } | null): UndoPayload => ({
  kind: "RESTORE_FIELDS",
  model: "settings",
  id: "",
  prev: { sleepTargetWake: s?.sleepTargetWake ?? null, sleepHours: s?.sleepHours ?? null, sleepFromWake: s?.sleepFromWake ?? null, sleepStep: s?.sleepStep ?? 0, sleepStepAt: iso(s?.sleepStepAt) },
})

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export interface StartSleepInput {
  nowWake: string // usually wakes now ("08:00")
  targetWake: string // the fixed wake time wanted ("06:00")
  hours: number // minutes asleep wanted
}

// POST /sleep: start (or restart) the plan. Week 1 is written into the day at once.
export const startSleepPlanService = async (userId: string, input: StartSleepInput, now = new Date()) => {
  if (!HHMM.test(input.nowWake) || !HHMM.test(input.targetWake)) throw new ValidationError("Times must look like 07:00")
  if (input.hours < MIN_HOURS || input.hours > MAX_HOURS) throw new ValidationError("Pick between 5 and 10 hours")
  if (toMin(input.targetWake) < 4 * 60) throw new ValidationError("A wake time before 4 am isn't something I'll plan")
  const before = await prisma.userSettings.findUnique({ where: { userId } })
  const steps = ladder(input.nowWake, input.targetWake, input.hours)
  const days = await applyStep(userId, steps[0]!)
  await upsertSettings(userId, { sleepTargetWake: input.targetWake, sleepHours: input.hours, sleepFromWake: input.nowWake, sleepStep: 1, sleepStepAt: now })
  const event = await recordActivity(userId, {
    type: "CREATED",
    itemType: "SETTING",
    title: `Sleep plan: wake ${input.targetWake}`,
    source: "APP",
    undo: { kind: "MANY", items: [days, settingsUndo(before)] },
  })
  return { ...(await getSleepPlanService(userId)), note: guidelineNote(input.hours), activityId: event?.id ?? null }
}

// POST /sleep/checkin: "how many days did you wake by 7:00?" The plan only
// moves on after 5 of 7; otherwise it stays, with no penalty.
export const sleepCheckinService = async (userId: string, daysOnTime: number, now = new Date()) => {
  const s = await prisma.userSettings.findUnique({ where: { userId } })
  const plan = planOf(s)
  if (!plan) throw new ValidationError("There's no sleep plan yet")
  // Once a week: the check-in screen and the My life card can both ask, but
  // the plan never moves twice in one week.
  if (plan.stepAt && now.getTime() - plan.stepAt.getTime() < 6 * 86_400_000) {
    return { ...(await getSleepPlanService(userId)), moved: false, message: "Already checked this week. Same times until next week.", activityId: null }
  }
  const r = nextStep(plan.step, plan.steps.length, Math.max(0, Math.min(7, Math.round(daysOnTime))))
  let activityId: string | null = null
  if (r.moved) {
    const days = await applyStep(userId, plan.steps[r.step - 1]!)
    await upsertSettings(userId, { sleepStep: r.step, sleepStepAt: now })
    const event = await recordActivity(userId, { type: "UPDATED", itemType: "SETTING", title: `Sleep plan: week ${r.step}`, source: "APP", undo: { kind: "MANY", items: [days, settingsUndo(s)] } })
    activityId = event?.id ?? null
  } else {
    // Staying on the same times still starts a new week, so the question comes back next week, not tomorrow.
    await upsertSettings(userId, { sleepStepAt: now })
  }
  const next = plan.steps[r.step - 1]!
  const message = r.moved
    ? r.done
      ? `Target reached. Sleep ${next.sleep === "24:00" ? "12:00" : next.sleep}, wake ${next.wake}. Keep it steady.`
      : `Nice. Next week: sleep ${next.sleep === "24:00" ? "12:00" : next.sleep}, wake ${next.wake}.`
    : r.done
      ? `You're on your target wake time. Keep it steady.`
      : `Same times one more week. No problem, that's how it sticks.`
  return { ...(await getSleepPlanService(userId)), moved: r.moved, message, activityId }
}
