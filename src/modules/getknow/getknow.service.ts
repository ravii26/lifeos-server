/* =====================================================================
   "Get to know you" (ADR 0034): reads what is already known, picks the
   next question, and applies an answer to the real data: the day
   schedule, the two settings, and memories Ally uses in chat.
   Answers and skips are logged as quiet SYSTEM events (title "know:<id>"),
   so no new table is needed. No AI is called anywhere in this file.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { saveMemories } from "../assistant/assistant.memory.js"
import { dayFromBasics } from "../now/now.rules.js"
import { getClock, getMode, setScheduleService } from "../now/now.service.js"
import { upsertSettings } from "../settings/settings.repository.js"
import { localDayStartMs } from "../../shared/utils/time.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import {
  HELP_BY_CHIP,
  QUESTIONS,
  STYLE_BY_CHIP,
  answeredCount,
  askedToday,
  nextQuestion,
  parseHours,
  parseTime,
  questionById,
  type KnowEvent,
  type KnowId,
  type KnowQuestion,
  type KnowState,
} from "./getknow.rules.js"

const PREFIX = "know:"

const loadState = async (userId: string): Promise<KnowState> => {
  const c = await getClock(userId)
  const [rows, schedules, projects, settings] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { userId, itemType: "SETTING", type: "UPDATED", title: { startsWith: PREFIX } },
      orderBy: { at: "asc" },
      select: { title: true, reason: true, at: true },
    }),
    prisma.daySchedule.count({ where: { userId } }),
    prisma.project.count({ where: { userId } }),
    prisma.userSettings.findUnique({ where: { userId }, select: { focus: true, directness: true } }),
  ])
  const events: KnowEvent[] = rows
    .map((r) => ({ id: (r.title ?? "").slice(PREFIX.length) as KnowId, at: r.at, skipped: r.reason === "SKIPPED", value: r.reason === "SKIPPED" ? "" : (r.reason ?? "") }))
    .filter((e) => questionById(e.id))

  // Things the person already set up another way are never asked again.
  const known = new Set<KnowId>()
  if (schedules > 0) (["wake", "sleep", "hours"] as KnowId[]).forEach((k) => known.add(k))
  if (projects > 0) known.add("goal")
  if (settings && settings.directness !== "BALANCED") known.add("style")
  if (settings && settings.focus !== "ALL") known.add("help")
  return { events, known, now: new Date(), todayStartMs: localDayStartMs(c.todayKey, c.tz) }
}

export interface KnowCard {
  question: KnowQuestion | null
  answered: number
  total: number
}

// The next question for this person, or none: nothing left, enough for today, or they are
// sick, away or busy (not the moment to ask anything).
export const getKnowService = async (userId: string): Promise<KnowCard> => {
  const [state, settings] = await Promise.all([loadState(userId), prisma.userSettings.findUnique({ where: { userId }, select: { busyUntil: true } })])
  const { mode } = await getMode(userId, state.now)
  const resting = mode === "SICK" || mode === "TRAVEL" || mode === "HOLIDAY" || (settings?.busyUntil != null && settings.busyUntil > state.now)
  return { question: resting ? null : nextQuestion(state), answered: answeredCount(state), total: QUESTIONS.length }
}

// ---- applying an answer -----------------------------------------------------------------------------

const remember = async (userId: string, content: string, kind: "GOAL" | "STRUGGLE" | "PREFERENCE" | "FACT" | "PERSON") => {
  const known = await prisma.memory.findMany({ where: { userId }, take: 300 })
  const saved = await saveMemories(userId, [{ content, kind, importance: 3, source: "SAID", sensitive: false }], known)
  return saved.length > 0
}

const latestValue = (events: KnowEvent[], id: KnowId): string | null => {
  const e = [...events].reverse().find((x) => x.id === id && !x.skipped)
  return e?.value || null
}

const nice = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  const hour = (h! % 12) || 12
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h! < 12 ? "am" : "pm"}`
}

// Builds the week from wake, sleep and (when known) work hours, the same way the first-run form does.
const applyDay = async (userId: string, events: KnowEvent[]): Promise<string | null> => {
  const wakeAns = latestValue(events, "wake")
  const sleepAns = latestValue(events, "sleep")
  if (!wakeAns || !sleepAns) return null
  const wake = parseTime(wakeAns, "wake")
  const sleep = parseTime(sleepAns, "sleep")
  if (!wake || !sleep) return null
  const hoursAns = latestValue(events, "hours")
  const hours = hoursAns ? parseHours(hoursAns) : null
  const office = hours && "start" in hours ? hours : null
  const workDay = office ? dayFromBasics({ wake, sleep, office }) : null
  const offDay = dayFromBasics({ wake, sleep })
  if (!offDay || (office && !workDay)) return null
  const workDays = workDay ? [1, 2, 3, 4, 5] : []
  if (workDays.length) await setScheduleService(userId, workDays, workDay, "APP")
  await setScheduleService(userId, [0, 1, 2, 3, 4, 5, 6].filter((d) => !workDays.includes(d)), offDay, "APP")
  return `Your days are set: up at ${nice(wake)}${office ? `, work ${nice(office.start)} to ${nice(office.end)} on weekdays` : ""}, bed around ${nice(sleep)}. You can change this any time in You, Your day.`
}

export interface KnowResult {
  message: string
  retry: boolean // the answer could not be read; ask again, nothing was recorded
}

export const answerKnowService = async (userId: string, id: string, input: { answer?: string; skip?: boolean }): Promise<KnowResult> => {
  const q = questionById(id)
  if (!q) throw new ValidationError("Unknown question")
  const log = (reason: string) => recordActivity(userId, { type: "UPDATED", itemType: "SETTING", title: `${PREFIX}${q.id}`, reason, source: "SYSTEM" })

  if (input.skip) {
    await log("SKIPPED")
    return { message: "No problem. I'll ask again another time, or never, if you skip it twice.", retry: false }
  }
  const answer = (input.answer ?? "").trim().slice(0, 500)
  if (!answer) throw new ValidationError("Tap an answer, type one, or skip")
  const lower = answer.toLowerCase()

  // Answers that must be readable are checked before anything is recorded.
  if (q.id === "wake" && !parseTime(answer, "wake")) return { message: "I couldn't read that as a time. Try something like 6:30.", retry: true }
  if (q.id === "sleep" && !parseTime(answer, "sleep")) return { message: "I couldn't read that as a time. Try something like 11:30.", retry: true }
  if (q.id === "hours" && !parseHours(answer)) return { message: "I couldn't read that. Try something like 9 to 6, or tap one.", retry: true }

  await log(answer)
  const events = (await loadState(userId)).events

  switch (q.id) {
    case "goal": {
      await remember(userId, `Wants to: ${answer}`, "GOAL")
      return { message: `Got it. I'll keep that in mind. Say "make me a plan to ${answer.slice(0, 60).replace(/[.!?]+$/, "")}" whenever you want a weekly plan for it.`, retry: false }
    }
    case "wake":
    case "sleep":
    case "hours": {
      const set = await applyDay(userId, events)
      if (set) return { message: set, retry: false }
      return { message: q.id === "hours" ? "Noted. I'll fit your days around that once I know when you wake and sleep." : "Noted.", retry: false }
    }
    case "drain": {
      if (!/nothing much/.test(lower)) await remember(userId, `Loses time to: ${answer}`, "STRUGGLE")
      return { message: /nothing much/.test(lower) ? "Good to hear." : "Thanks. I'll keep that in mind, without nagging.", retry: false }
    }
    case "style": {
      const directness = STYLE_BY_CHIP[lower]
      if (directness) await upsertSettings(userId, { directness })
      return { message: directness === "DIRECT" ? "Okay, I'll say things plainly." : directness === "GENTLE" ? "Okay, I'll be gentle." : "Okay, a bit of both.", retry: false }
    }
    case "help": {
      const focus = HELP_BY_CHIP[lower]
      if (focus) await upsertSettings(userId, { focus })
      return { message: "Got it. I'll lead with that. You can change it in You, How Ally works for you.", retry: false }
    }
    case "focus_time": {
      await remember(userId, `Works and thinks best in the ${answer.toLowerCase().replace(/^late at night$/, "late night")}`, "PREFERENCE")
      return { message: "Good to know. I'll put the hard things there.", retry: false }
    }
    case "health": {
      await remember(userId, `Exercise and diet: ${answer}`, "FACT")
      return { message: "Thanks. I'll fit my suggestions around that.", retry: false }
    }
    case "people": {
      await remember(userId, `Important people: ${answer}`, "PERSON")
      return { message: "I'll remember them.", retry: false }
    }
  }
}

export { QUESTIONS, askedToday }
