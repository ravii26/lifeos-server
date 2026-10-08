/* =====================================================================
   Assistant chat with actions. One message in → the AI plans a short
   reply plus a list of actions (add task, complete task, log habit, set
   reminder…). The server validates every action against the user's real
   data and executes it; the AI never writes to the database directly.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { createTaskService, completeTaskService } from "../task/task.service.js"
import { logHabitService, createHabitService } from "../habit/habit.service.js"
import { createProjectService } from "../project/project.service.js"
import { createAllyNoteService } from "../allynote/allynote.service.js"
import { localToUtc, repeatToRule, isAmbiguousCompletion } from "./assistant.capture.js"
import {
  getNowService,
  setModeService,
  setScheduleService,
  capacityTodayService,
  type NowDto,
} from "../now/now.service.js"
import { MODES, BLOCKS, type Mode } from "../now/now.rules.js"
import {
  getStandService,
  listStandsService,
  logProgressService,
  setProjectStatusService,
  weekCardService,
  refreshHabitStagesService,
  type ProjectStatusChange,
} from "../progress/progress.service.js"
import { getTonightService } from "../guide/guide.service.js"
import { extractUrl } from "../guide/guide.saves.ai.js"
import { upsertSettings } from "../settings/settings.repository.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { loadPatternFacts, detectPatterns } from "./assistant.patterns.js"
import { recallMemories, saveMemories, forgetMemories, type MemoryWrite } from "./assistant.memory.js"
import { assistantAsk } from "./assistant.service.js"
import { todayKeyInTz, weekdayInTz, dateFromKey, dayKeyInTz } from "../../shared/utils/time.util.js"
import logger from "../../lib/logger.js"

export type ChatTurn = { role: "user" | "assistant"; text: string }

// activityId lets the app offer Undo for the action (see /activity/:id/undo).
export type ChatAction = (
  | { type: "TASK_ADDED"; id: string; title: string }
  | { type: "TASK_COMPLETED"; id: string; title: string }
  | { type: "HABIT_LOGGED"; id: string; title: string }
  | { type: "REMINDER_SET"; id: string; text: string; remindAt: string; windowEnd?: string; repeatRule?: string }
  | { type: "HABIT_ADDED"; id: string; title: string; timeBlock?: string; prep?: string; anchor?: string; sizes?: { minutes: number; label: string }[] }
  | { type: "PROJECT_ADDED"; id: string; title: string; kind: string; deadline?: string; priority: string; tasks: number }
  | { type: "NOTE_ADDED"; id: string; title: string; collection: string; template: string; items: string[] }
  // The right-now answer from the rules engine (sized options, never invented).
  | { type: "NOW_PICK"; kind: string; options: { id: string; sourceType: string; title: string; minutes: number; smaller: boolean; minimum: string }[] }
  | { type: "STAND"; items: { id: string; title: string; kind: string; message: string; options: string[] }[] }
  | { type: "PROGRESS_LOGGED"; id: string; title: string; what: string; message: string }
  | { type: "PROJECT_STATUS"; id: string; title: string; status: string }
  | { type: "WEEK_CARD"; message: string }
  | { type: "MODE_SET"; mode: string; until?: string }
  | { type: "SCHEDULE_SET"; days: string[] }
  // Ambiguous request: nothing was changed, the person picks (tap sends the exact title).
  | { type: "ASK"; question: string; options: { id: string; title: string }[] }
  | { type: "OPEN_SAVE"; text: string }
  // Nudges are opt-in: only the person turns them on or off. NIGHTLY is
  // stored on the server; MORNING lives on the phone.
  | { type: "NUDGE_SET"; kind: "NIGHTLY" | "MORNING"; time: string | null }
  | { type: "REMEMBERED"; id: string; text: string }
  | { type: "FORGOT"; id: string; text: string }
) & { activityId?: string }

export interface ChatResult {
  role: "FRIEND" | "ASSISTANT" | "MENTOR" | "COACH" | "GUIDE"
  reply: string
  actions: ChatAction[]
  // Things Ally would add but wants a yes first (e.g. a habit for a new goal).
  suggestions?: { kind: "HABIT"; title: string }[]
  // More planned for today than there is free time: what stays, what could move.
  capacity?: { message: string; plannedMinutes: number; freeMinutes: number; keep: { id: string; title: string }[]; move: { id: string; title: string }[] }
  usedAi: boolean
}

// ---- context -------------------------------------------------------

const loadContext = async (userId: string, message: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true, name: true } })
  const timeZone = user?.timezone ?? "Asia/Kolkata"
  const todayKey = todayKeyInTz(timeZone)
  const [areas, tasks, habits, reminders, identity, tonight, settings, memories, patternFacts, projects] = await Promise.all([
    prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true, tier: true } }),
    prisma.task.findMany({
      where: { userId, status: { in: ["TODO", "IN_PROGRESS"] } },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 40,
      select: { id: true, title: true, dueDate: true, areaId: true },
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true },
      take: 40,
      select: { id: true, title: true, logs: { where: { date: dateFromKey(todayKey), completed: true }, select: { id: true } } },
    }),
    prisma.reminder.findMany({
      where: { userId, status: "PENDING", remindAt: { gte: new Date() } },
      orderBy: { remindAt: "asc" },
      take: 10,
      select: { text: true, remindAt: true },
    }),
    prisma.identity.findUnique({ where: { userId }, select: { thisYearGoal: true } }),
    getTonightService(userId).catch(() => null),
    prisma.userSettings.findUnique({ where: { userId }, select: { nightlyTime: true } }),
    recallMemories(userId, message),
    loadPatternFacts(userId).catch(() => null),
    prisma.project.findMany({ where: { userId, status: { in: ["ACTIVE", "PAUSED"] } }, take: 20, select: { id: true, title: true, kind: true, status: true } }),
  ])
  return {
    timeZone,
    todayKey,
    name: user?.name ?? "",
    areas,
    tasks,
    projects,
    habits,
    reminders,
    identity,
    tonight,
    nightlyNudge: settings?.nightlyTime ?? null,
    memories,
    patterns: patternFacts ? detectPatterns(patternFacts) : [],
  }
}

type Ctx = Awaited<ReturnType<typeof loadContext>>

const nowLocal = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())

const contextJson = (ctx: Ctx) =>
  JSON.stringify({
    now: `${ctx.todayKey} ${nowLocal(ctx.timeZone)} (${weekdayInTz(ctx.timeZone)})`,
    name: ctx.name,
    whatYouRemember: ctx.memories.map((m) => ({
      id: m.id,
      kind: m.kind,
      memory: m.content,
      saved: m.createdAt.toISOString().slice(0, 10),
    })),
    yearGoal: ctx.identity?.thisYearGoal ?? null,
    areas: ctx.areas,
    // Real dates for the next 7 days so "Thursday" is looked up, not calculated.
    nextDays: Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => {
        const at = new Date(Date.now() + i * 86_400_000)
        return [i === 0 ? `today (${weekdayInTz(ctx.timeZone, at)})` : weekdayInTz(ctx.timeZone, at), dayKeyInTz(at, ctx.timeZone)]
      }),
    ),
    activeProjects: ctx.projects,
    habits: ctx.habits.map((h) => h.title),
    tonightsOneThing: ctx.tonight?.commitment
      ? {
          title: ctx.tonight.commitment.title,
          minimum: ctx.tonight.commitment.minimum,
          why: ctx.tonight.commitment.why,
          status: ctx.tonight.commitment.status,
        }
      : null,
    openTasks: ctx.tasks.map((t) => ({ id: t.id, title: t.title, due: t.dueDate?.toISOString().slice(0, 10) ?? null })),
    habitsNotDoneToday: ctx.habits.filter((h) => h.logs.length === 0).map((h) => ({ id: h.id, title: h.title })),
    patternsNoticed: ctx.patterns,
    nightlyNudge: ctx.nightlyNudge ? `on at ${ctx.nightlyNudge}` : "off",
    upcomingReminders: ctx.reminders.map((r) => ({ text: r.text, at: r.remindAt.toISOString() })),
  })

// ---- AI planning ---------------------------------------------------

const SYSTEM_PROMPT = `You are Ally: one companion who knows this person's life (context below). In every reply you take exactly ONE role, chosen from what they need right now:
- FRIEND: they vent, share their day, or feel low. Listen first, reflect what you heard, no fixing unless they ask. If they seem lonely or carry something heavy, gently encourage talking to someone real in their life (use people from memory by name when you can). You are never a replacement for family or friends.
- ASSISTANT: tasks, reminders, plans, "what should I do now". Act, confirm in a few words.
- MENTOR: software engineering career (DSA, system design, AI/ML, interviews, getting a high-paying role). Give the next concrete step for their level, not a curriculum. Prefer doing (solve, build, explain out loud) over watching more content.
- COACH: fitness, diet, consistency. Small, specific, repeatable; the minimum version counts. No medical or diet prescriptions beyond general guidance.
- GUIDE: big life, career, or money decisions. Name the real trade-off, tie it to their stated goals, and give a clear lean. For money: general frameworks only, you are not a licensed financial adviser, never pick specific stocks/funds.

How you talk (all roles):
- Short: 1-3 sentences, plain words. Honest and practical, no motivational fluff, no hype, no emoji, no exclamation marks.
- At most ONE question per reply, and only if you truly need it. One step at a time.
- No guilt or shaming, ever. A miss is information, not failure.
- Never claim you did something that is not in actions.
- If they mention self-harm or wanting to die: respond with care, urge them to reach someone they trust now and to call Tele-MANAS 14416 (India, free, 24/7). Do nothing else in that reply.

Patterns (patternsNoticed in context are computed from their real data):
- If one is relevant to what they're saying, you may point it out once, kindly, with the evidence, and redirect to one small action. Example: they ask for another video to watch while CONSUMING_NOT_DOING → suggest doing something with what they already saved.
- Also notice from the conversation itself if they keep seeking certainty before acting (many "should I" questions, wanting the perfect plan): name it gently and propose a small reversible first step.
- Don't lecture. Never mention a pattern when they are venting or low.

You can take actions. Only use ids that appear in the context. Actions:
- {"type":"ADD_TASK","title":string,"minimum":string|null,"areaId":string|null,"due":"YYYY-MM-DD"|null,"priority":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"|null,"sizeMinutes":number|null,"block":"MORNING"|"COMMUTE"|"OFFICE"|"GYM"|"EVENING"|"NIGHT"|null}   (sizeMinutes = a realistic estimate, block = where in the day it belongs, null if anytime; office work is OFFICE.)
- {"type":"COMPLETE_TASK","taskId":string}
- {"type":"LOG_HABIT","habitId":string}
- {"type":"SET_REMINDER","text":string,"at":"YYYY-MM-DDTHH:mm","windowEnd":"YYYY-MM-DDTHH:mm"|null,"repeat":{"freq":"DAILY"|"WEEKLY"|"MONTHLY","days":["SU"...]}|null}   (local time; resolve "at 7" / "tomorrow" / "in 2 hours" from "now". "sometime between 5 and 7" -> at=5, windowEnd=7. "every Sunday" -> repeat WEEKLY days ["SU"], at = the next Sunday; with no time said use 09:00.)
- {"type":"WHERE_I_STAND","projectId":string|null}   ("where do I stand on my job switch / how is my weight going / how am I doing on X". projectId from activeProjects, null = all. The app computes the answer.)
- {"type":"LOG_PROGRESS","projectId":string,"count":number|null,"minutes":number|null,"value":number|null,"milestoneDone":boolean|null}   (they report progress on a project in activeProjects: "I solved 23 DSA problems" -> count 23 on the MILESTONE project; "did 45 minutes of English" -> minutes 45 on the PRACTICE project; "weight is 83.2" -> value 83.2 on the OUTCOME project; "my resume is ready" -> milestoneDone true. Only one of count / minutes / value / milestoneDone.)
- {"type":"SET_PROJECT_STATUS","projectId":string,"status":"PAUSED"|"ABANDONED"|"ACTIVE"|"COMPLETED"}   ("pause my investing goal" -> PAUSED; "let it go / drop it / I don't want this any more" -> ABANDONED; "resume it" -> ACTIVE; "I finished it" -> COMPLETED. Never delete.)
- {"type":"WEEK_CARD"}   ("how was my week", "weekly review". Only when they ask.)
- {"type":"WHAT_NOW","minutes":number|null}   (they ask what to do now / what to work on / "I have 20 minutes". The app answers from their real day, you only emit this. minutes = the time they said, else null.)
- {"type":"SET_MODE","mode":"NORMAL"|"BUSY"|"SICK"|"TRAVEL"|"HOLIDAY","until":"YYYY-MM-DD"|null}   ("I'm sick" -> SICK; "busy week" -> BUSY with until = this Sunday; "I'm better / back to normal" -> NORMAL; "I'm travelling / on holiday until Friday" -> TRAVEL / HOLIDAY.)
- {"type":"SET_SCHEDULE","days":["MON"..],"blocks":[{"block":"MORNING"|"COMMUTE"|"OFFICE"|"GYM"|"EVENING"|"NIGHT","start":"HH:mm","end":"HH:mm"}]}   (they describe their day: "I work 10 to 8:30 on weekdays, gym right after". Give the blocks they described; the app fills the rest. Also remember it.)
- {"type":"ADD_HABIT","title":string,"minimum":string|null,"prepare":string|null,"prepTime":"HH:mm"|null,"timeBlock":"MORNING"|"COMMUTE"|"OFFICE"|"GYM"|"EVENING"|"NIGHT"|null,"days":["MON"...]|null,"anchor":string|null,"sizes":[{"minutes":number,"label":string}]|null,"reminderTime":"HH:mm"|null,"areaId":string|null}   (something they want to do repeatedly. anchor = what it follows ("after my morning coffee"); set timeBlock to the part of the day that anchor falls in. sizes = their smaller and bigger versions, smallest first, e.g. [{"minutes":2,"label":"read 2 pages"},{"minutes":10,"label":"read 10 pages"}]; always include a 2-minute size when they give any. A habit that needs setup the night before ("prep the night before") is TWO ADD_HABITs: the habit, and a "Prep ..." habit with timeBlock EVENING and reminderTime at the prep time, 21:30 if not said.)
- {"type":"ADD_PROJECT","title":string,"kind":"OUTCOME"|"MILESTONE"|"PRACTICE"|"WORK","why":string|null,"priority":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","deadline":"YYYY-MM-DD"|null,"areaId":string|null,"milestones":[string|{"title":string,"target":number|null}]|null,"metric":{"name":string,"unit":string,"start":number,"target":number}|null,"weeklyTargetMinutes":number|null,"tasks":[{"title":string,"due":"YYYY-MM-DD"|null,"priority":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"|null}]}   (anything with an outcome. WORK = a deliverable with a deadline; MILESTONE = a goal with stages like a job switch; OUTCOME = a number to move; PRACTICE = weekly practice time. Always include 1-4 concrete first to-dos in "tasks" (for WORK the first to-do is the deliverable itself, with the project's deadline and priority). Put "why" in their words if they said it. OUTCOME needs "metric" (weight 85 -> 70 kg: name Weight, unit kg, start 85, target 70). PRACTICE needs "weeklyTargetMinutes". MILESTONE stages that are counted carry a target, e.g. {"title":"50 DSA problems","target":50}; uncounted ones ("Resume ready") have target null. Stages they say are already done are still listed, then logged with LOG_PROGRESS milestoneDone.)
- {"type":"ADD_NOTE","collection":string,"template":"LIST"|"ROUTINE"|"PLAYBOOK"|"INFO","title":string,"items":[string],"text":string|null}   (something they TEACH you to keep: their breakfast options, gym warm-up steps, "when X do Y", client details. LIST/ROUTINE use items; PLAYBOOK/INFO use text. collection is a short name like "Breakfast" or "Gym".)
- {"type":"SET_NUDGE","kind":"NIGHTLY"|"MORNING","time":"HH:mm"|null}   (null turns it off)

Action rules:
- "What should I do now / what should I work on / I have N minutes" (any language): emit WHAT_NOW. Do not pick the item yourself.
- When they say they finished something, complete the matching task or habit.
- When they ask to be reminded, set a reminder. When they clearly mention something they need to do, add a task (ask nothing unless truly unclear).
- One long message can hold many things: emit one action per thing (up to 12). Do not merge unrelated things and do not invent extra ones. Do not duplicate what activeProjects, habits or openTasks already hold.
- When they say a goal ("I want to switch jobs in 6 months"), create the project (MILESTONE for a goal with stages, with 3-5 stage names in milestones, why, a deadline from the timeframe) plus EXACTLY 3 starter to-dos in "tasks" (concrete first steps, never fewer than 3). Do NOT add a habit for it yourself: put exactly one fitting habit in "suggest" for them to confirm.
- If the request is unclear in a way you cannot resolve (two different readings, a missing time that matters), ask ONE short question and emit no action. Missing details that have a sensible default are not a reason to ask.
- When two or more open to-dos could match "done with X", do not guess: ask which one and emit no COMPLETE_TASK.

Language: they often write Hinglish (Hindi in Roman letters, sometimes Devanagari) or mix it with English. Understand it fully: kal = tomorrow, parso = day after tomorrow, aaj = today, subah = morning, dopahar = afternoon, shaam = evening, raat = night, baje = o'clock ("7 baje" in a reminder means 19:00 if it is evening/night talk, otherwise the next 7), yaad dilana / yaad dila dena = remind me, karna hai = need to do, ho gaya / kar liya = done, har roz = every day, har Sunday / har ravivar = every Sunday, mummy = their mother. Reply in the same style they wrote in (Hinglish back to Hinglish, English to English), keep reminder text in their words.
- You never message them on your own. Only when they ask ("nudge me every night at 9:30", "stop the nightly reminders") set or clear a nudge with SET_NUDGE.
- When they vent or share their day, do not turn it into tasks unless they ask.

Memory:
- whatYouRemember is what you already know about them. Use it naturally so they never repeat themselves; don't recite it back.
- Each remember item also has "source": "SAID" if they told you directly, "INFERRED" if you concluded it; and "sensitive": true for health or mental-health details (those are never brought up unless they raise them).
- remember: up to 3 NEW durable things worth knowing later: their schedule, goals, struggles, preferences, people in their life, notable events, or how they felt (include the date for feelings/events, e.g. "Felt drained on 5 Oct after manager changed priorities"). Short, third person. Never save tasks/reminders (those are actions), small talk, or anything already in whatYouRemember.
- kind: FACT | PREFERENCE | GOAL | STRUGGLE | FEELING | PERSON | EVENT. importance: 1 minor, 2 useful, 3 core to who they are.
- forget: ids from whatYouRemember to delete, when they ask you to forget something or it is no longer true (then remember the corrected version).
- When they ask what you know about them, answer from whatYouRemember.

Return JSON only: {"role": "FRIEND"|"ASSISTANT"|"MENTOR"|"COACH"|"GUIDE", "reply": string, "actions": [ ... ], "suggest": [{"kind":"HABIT","title":string}], "remember": [{"content": string, "kind": string, "importance": number, "source": "SAID"|"INFERRED", "sensitive": boolean}], "forget": [string]}`

interface PlannedAction {
  type?: string
  title?: string
  minimum?: string | null
  areaId?: string | null
  due?: string | null
  taskId?: string
  habitId?: string
  text?: string
  at?: string
  time?: string | null
  kind?: string
  priority?: string
  windowEnd?: string | null
  repeat?: { freq?: unknown; days?: unknown } | null
  prepare?: string | null
  prepTime?: string | null
  timeBlock?: string | null
  days?: unknown
  anchor?: string | null
  reminderTime?: string | null
  why?: string | null
  deadline?: string | null
  milestones?: unknown
  tasks?: { title?: string; due?: string | null; priority?: string | null }[]
  sizes?: unknown
  collection?: string
  template?: string
  items?: unknown
  projectId?: string | null
  count?: number | null
  value?: number | null
  milestoneDone?: boolean | null
  status?: string
  metric?: { name?: string; unit?: string; start?: number; target?: number } | null
  weeklyTargetMinutes?: number | null
  minutes?: number | null
  mode?: string
  until?: string | null
  blocks?: unknown
  sizeMinutes?: number | null
  block?: string | null
}

export const ROLES = ["FRIEND", "ASSISTANT", "MENTOR", "COACH", "GUIDE"] as const
export type ChatRole = (typeof ROLES)[number]

interface Plan {
  role: ChatRole
  reply: string
  actions: PlannedAction[]
  suggest: { kind: "HABIT"; title: string }[]
  remember: MemoryWrite[]
  forget: unknown[]
}

const MAX_ACTIONS = 12

const parsePlan = (raw: string): Plan => {
  const p = JSON.parse(raw) as { role?: unknown; reply?: unknown; actions?: unknown; suggest?: unknown; remember?: unknown; forget?: unknown }
  const reply = typeof p.reply === "string" ? p.reply.trim() : ""
  if (!reply) throw new Error("Chat AI returned no reply")
  return {
    role: ROLES.includes(p.role as ChatRole) ? (p.role as ChatRole) : "ASSISTANT",
    reply: reply.slice(0, 1200),
    actions: Array.isArray(p.actions) ? (p.actions as PlannedAction[]).slice(0, MAX_ACTIONS) : [],
    suggest: Array.isArray(p.suggest)
      ? (p.suggest as { kind?: unknown; title?: unknown }[])
          .filter((x) => x?.kind === "HABIT" && typeof x.title === "string" && x.title.trim())
          .slice(0, 2)
          .map((x) => ({ kind: "HABIT" as const, title: String(x.title).trim().slice(0, 120) }))
      : [],
    remember: Array.isArray(p.remember) ? (p.remember as MemoryWrite[]) : [],
    forget: Array.isArray(p.forget) ? p.forget : [],
  }
}

const toMessages = (ctx: Ctx, message: string, history: ChatTurn[]) => [
  { role: "system" as const, content: `${SYSTEM_PROMPT}\n\nContext: ${contextJson(ctx)}` },
  ...history.slice(-10).map((h) => ({ role: h.role, content: h.text.slice(0, 1500) })),
  { role: "user" as const, content: message },
]

const planWithGroq = async (ctx: Ctx, message: string, history: ChatTurn[]): Promise<Plan> => {
  if (!groqClient) throw new Error("Groq client not initialized")
  const res = await groqClient.chat.completions.create({
    messages: toMessages(ctx, message, history),
    model: "openai/gpt-oss-120b",
    response_format: { type: "json_object" },
  })
  return parsePlan(res.choices[0]?.message?.content || "{}")
}

const planWithGemini = async (ctx: Ctx, message: string, history: ChatTurn[]): Promise<Plan> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")
  const model = geminiClient.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  })
  const convo = history
    .slice(-10)
    .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.text.slice(0, 1500)}`)
    .join("\n")
  const result = await model.generateContent([
    { text: `${SYSTEM_PROMPT}\n\nContext: ${contextJson(ctx)}` },
    { text: `${convo}\nUser: ${message}` },
  ])
  return parsePlan(result.response.text())
}

// ---- nudge requests (deterministic backup) --------------------------

// Turning nudges on/off is a setting, so it must not depend on the model
// remembering to emit SET_NUDGE. These patterns catch the plain requests.
const NUDGE_OFF = /\b(stop|turn off|disable|cancel|no more|don'?t)\b[^.?!]*\b(nudg\w*|nightly (reminder|message|notification)s?|morning (heads.?up|reminder|message)s?)/i
const NUDGE_ON = /\b(nudge|ping|notify|remind)\b[^.?!]*\b(every|each)\s+(night|evening|morning|day)\b/i

export const parseClock = (text: string): string | null => {
  const m = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const ampm = m[3]?.toLowerCase()
  if (ampm === "pm" && h < 12) h += 12
  if (ampm === "am" && h === 12) h = 0
  if (!ampm && /night|evening/i.test(text) && h >= 1 && h <= 11) h += 12
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}

export const nudgeRequest = (text: string): PlannedAction | null => {
  const kind = /morning/i.test(text) ? "MORNING" : "NIGHTLY"
  if (NUDGE_OFF.test(text)) return { type: "SET_NUDGE", kind, time: null }
  if (NUDGE_ON.test(text)) {
    const time = parseClock(text)
    return time ? { type: "SET_NUDGE", kind, time } : null
  }
  return null
}

// ---- safety and patterns (deterministic) ---------------------------

// Crisis language always gets the same careful answer with a helpline, no
// matter what the model would have said.
const CRISIS = /\b(kill myself|suicid\w*|end (it all|my life)|want to die|don'?t want to (live|be alive)|self[- ]?harm|hurt myself|no reason to live)\b/i

export const isCrisis = (text: string) => CRISIS.test(text)

const EXPLICIT_TASK = /\b(add|task|remind|to-?do|todo|habit|project|goal|put .* on my list|note (it|that) down|yaad)\b/i

const CREATES = new Set(["ADD_TASK", "ADD_HABIT", "ADD_PROJECT", "ADD_NOTE", "SET_REMINDER"])

export const CRISIS_REPLY =
  "I'm really glad you told me, and I'm sorry it feels this heavy. Please reach someone right now: a person you trust, or Tele-MANAS at 14416 (free, 24/7, India). If you're in immediate danger, call 112. I'm here to keep talking while you do."

// Asking for more content while saved things sit unused gets one honest
// line with the evidence, added by the server so it never depends on the
// model noticing.
const MORE_CONTENT = /\b(video|watch|course|tutorial|playlist|book|article|channel|podcast|resource)s?\b/i

export const contentRedirect = (text: string, patterns: { id: string; evidence: string }[], reply: string) => {
  const p = patterns.find((x) => x.id === "CONSUMING_NOT_DOING")
  if (!p || !MORE_CONTENT.test(text) || /saved|already/i.test(reply)) return null
  return `Honest note: ${p.evidence} Pick one of those and do something with it before adding more.`
}

// ---- execution -----------------------------------------------------

export { localToUtc }

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const
type Prio = (typeof PRIORITIES)[number]
const prio = (p: unknown): Prio | undefined => {
  const v = String(p ?? "").toUpperCase()
  return (PRIORITIES as readonly string[]).includes(v) ? (v as Prio) : undefined
}
const size = (v: unknown) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 && n <= 1440 ? n : undefined
}
const blockOf = (v: unknown) => (BLOCKS as readonly string[]).includes(String(v).toUpperCase()) ? (String(v).toUpperCase() as (typeof BLOCKS)[number]) : undefined
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const milestoneList = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .map((m) => {
      const o = typeof m === "string" ? { title: m, target: undefined } : (m as { title?: unknown; target?: unknown })
      const title = String(o?.title ?? "").trim().slice(0, 200)
      const t = Math.round(Number(o?.target))
      return { title, target: Number.isFinite(t) && t > 0 ? t : undefined }
    })
    .filter((m) => m.title)
    .slice(0, 8)
const metricOf = (v: PlannedAction["metric"], kind: string) => {
  if (kind !== "OUTCOME" || !v?.name?.trim()) return undefined
  const start = Number(v.start)
  const target = Number(v.target)
  return Number.isFinite(start) && Number.isFinite(target) && start !== target
    ? { name: v.name.trim().slice(0, 80), unit: String(v.unit ?? "").trim().slice(0, 20), startValue: start, targetValue: target }
    : undefined
}
const habitSizes = (v: unknown) => {
  if (!Array.isArray(v)) return undefined
  const out = v
    .map((s) => ({ minutes: Math.round(Number((s as { minutes?: unknown })?.minutes)), label: String((s as { label?: unknown })?.label ?? "").trim().slice(0, 120) }))
    .filter((s) => Number.isFinite(s.minutes) && s.minutes > 0 && s.minutes <= 600 && s.label)
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, 4)
  return out.length ? out : undefined
}
const num = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && Number(v) > 0 ? Number(v) : undefined)
const dayOnly = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const clock = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined)
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").trim()
const strings = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()).slice(0, max) : []

// Habits and projects need an area. Use the one the model chose if it is
// theirs, else their Main area, else any; a brand-new account gets "General".
const pickArea = async (userId: string, ctx: Ctx, areaId?: string | null): Promise<string> => {
  if (areaId && ctx.areas.some((a) => a.id === areaId)) return areaId
  const fallback = ctx.areas.find((a) => a.tier === "MAIN") ?? ctx.areas[0]
  if (fallback) return fallback.id
  const area = await prisma.area.create({
    data: { userId, name: "General", tier: "MAINTAIN", color: "#8a8a8a", icon: "circle", order: 99 },
    select: { id: true, name: true, tier: true },
  })
  ctx.areas.push(area)
  return area.id
}

interface ExecResult {
  done: ChatAction[]
  say: string | null // the exact reply when rules, not the model, produce the answer
  skipped: number // duplicates we did not create again: not a failure
  asked: Extract<ChatAction, { type: "ASK" }> | null
}

const MODE_SAY: Record<Mode, string> = {
  NORMAL: "Back to normal. I'll plan your days again.",
  BUSY: "Busy mode on. I'll only ask for the smallest version of things until you say otherwise.",
  SICK: "Sick mode on. Everything is paused and I won't prompt you. Rest, drink water. Tell me when you're better.",
  TRAVEL: "Travel mode on. Plans are paused and I'll only ask for minimums until you're back.",
  HOLIDAY: "Holiday mode on. Plans are paused. Enjoy it, tell me when you're back.",
}

const execute = async (userId: string, ctx: Ctx, planned: PlannedAction[], message = ""): Promise<ExecResult> => {
  const done: ChatAction[] = []
  let skipped = 0
  let say: string | null = null
  let asked: ExecResult["asked"] = null
  const taskIds = new Map(ctx.tasks.map((t) => [t.id, t.title]))
  const habitIds = new Map(ctx.habits.map((h) => [h.id, h.title]))
  const areaIds = new Set(ctx.areas.map((a) => a.id))
  const openTitles = new Set(ctx.tasks.map((t) => norm(t.title)))
  const habitTitles = new Set(ctx.habits.map((h) => norm(h.title)))
  const projectTitles = new Set(ctx.projects.map((p) => norm(p.title)))

  for (const a of planned) {
    try {
      if (a.type === "ADD_TASK" && a.title?.trim()) {
        if (openTitles.has(norm(a.title))) {
          skipped++
          continue
        }
        const dueKey = dayOnly(a.due)
        const task = await createTaskService(
          userId,
          {
            title: a.title.trim().slice(0, 200),
            minimumVersion: a.minimum?.trim() || undefined,
            areaId: a.areaId && areaIds.has(a.areaId) ? a.areaId : undefined,
            dueDate: dueKey ? dateFromKey(dueKey) : undefined,
            priority: prio(a.priority),
            sizeMinutes: size(a.sizeMinutes),
            block: blockOf(a.block),
            source: "DUMP",
          },
          { source: "CHAT" },
        )
        openTitles.add(norm(task.title))
        done.push({ type: "TASK_ADDED", id: task.id, title: task.title, activityId: task.activityId })
      } else if (a.type === "COMPLETE_TASK" && a.taskId && taskIds.has(a.taskId)) {
        // Confidence tier: with more than one plausible to-do we ask, never guess.
        const options = isAmbiguousCompletion(message, ctx.tasks, a.taskId)
        if (options) {
          asked ??= { type: "ASK", question: "Which one did you finish?", options }
          continue
        }
        const task = await completeTaskService(a.taskId, userId, { source: "CHAT" })
        done.push({ type: "TASK_COMPLETED", id: a.taskId, title: taskIds.get(a.taskId)!, activityId: task.activityId })
      } else if (a.type === "LOG_HABIT" && a.habitId && habitIds.has(a.habitId)) {
        const log = await logHabitService(a.habitId, userId, { completed: true }, { source: "CHAT" })
        done.push({ type: "HABIT_LOGGED", id: a.habitId, title: habitIds.get(a.habitId)!, activityId: log.activityId })
      } else if (a.type === "SET_NUDGE" && (a.kind === "NIGHTLY" || a.kind === "MORNING")) {
        const time = typeof a.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(a.time) ? a.time : null
        if (a.time && !time) continue
        let activityId: string | undefined
        if (a.kind === "NIGHTLY") {
          await upsertSettings(userId, { nightlyTime: time })
          const event = await recordActivity(userId, {
            type: "UPDATED",
            itemType: "SETTING",
            title: time ? `Nightly nudge at ${time}` : "Nightly nudge off",
            source: "CHAT",
            undo: { kind: "RESTORE_SETTING", field: "nightlyTime", prev: ctx.nightlyNudge },
          })
          activityId = event?.id
        }
        done.push({ type: "NUDGE_SET", kind: a.kind, time, activityId })
      } else if (a.type === "SET_REMINDER" && a.text?.trim() && a.at) {
        const at = localToUtc(a.at, ctx.timeZone)
        if (!at || at.getTime() < Date.now() - 60_000) continue
        // "Between 5 and 7": the window must end after it starts.
        const end = a.windowEnd ? localToUtc(a.windowEnd, ctx.timeZone) : null
        const windowEnd = end && end.getTime() > at.getTime() ? end : null
        const repeatRule = repeatToRule(a.repeat)
        // A reminder is a to-do with a time.
        const task = await createTaskService(
          userId,
          {
            title: a.text.trim().slice(0, 200),
            remindAt: at,
            dueDate: at,
            windowEnd: windowEnd ?? undefined,
            repeatRule: repeatRule ?? undefined,
            source: "REMINDER",
          },
          { source: "CHAT" },
        )
        done.push({
          type: "REMINDER_SET",
          id: task.id,
          text: task.title,
          remindAt: at.toISOString(),
          ...(windowEnd && { windowEnd: windowEnd.toISOString() }),
          ...(repeatRule && { repeatRule }),
          activityId: task.activityId,
        })
      } else if (a.type === "WHERE_I_STAND") {
        await refreshHabitStagesService(userId).catch(() => [])
        const known = a.projectId && ctx.projects.some((p) => p.id === a.projectId)
        const items = known ? [await getStandService(userId, a.projectId!)] : (await listStandsService(userId)).slice(0, 4)
        say = items.length
          ? items.map((s) => `${s.title}: ${s.message}`).join("\n")
          : "You have no projects yet. Tell me a goal and I'll set it up with stages, so I can show where you stand."
        done.push({ type: "STAND", items: items.map((s) => ({ id: s.id, title: s.title, kind: s.kind, message: s.message, options: s.options })) })
      } else if (a.type === "LOG_PROGRESS" && a.projectId && ctx.projects.some((p) => p.id === a.projectId)) {
        const r = await logProgressService(
          userId,
          { projectId: a.projectId, count: num(a.count), minutes: num(a.minutes), value: Number.isFinite(Number(a.value)) && a.value !== null ? Number(a.value) : undefined, milestoneDone: a.milestoneDone === true },
          "CHAT",
        )
        say = `Logged: ${r.what}.\n${r.stand.title}: ${r.stand.message}`
        done.push({ type: "PROGRESS_LOGGED", id: r.stand.id, title: r.stand.title, what: r.what, message: r.stand.message, activityId: r.activityId })
      } else if (a.type === "SET_PROJECT_STATUS" && a.projectId && ctx.projects.some((p) => p.id === a.projectId)) {
        const status = String(a.status).toUpperCase() as ProjectStatusChange
        if (!["PAUSED", "ABANDONED", "ACTIVE", "COMPLETED"].includes(status)) continue
        const r = await setProjectStatusService(userId, a.projectId, status, "CHAT")
        say = `${r.title}: ${r.line}`
        done.push({ type: "PROJECT_STATUS", id: a.projectId, title: r.title, status, activityId: r.activityId })
      } else if (a.type === "WEEK_CARD") {
        const card = await weekCardService(userId)
        say = card.message
        done.push({ type: "WEEK_CARD", message: card.message })
      } else if (a.type === "WHAT_NOW") {
        const now: NowDto = await getNowService(userId, { minutes: size(a.minutes) ?? null })
        const prep = now.prep.map((p) => `Tonight's prep: ${p.prepare}.`).join(" ")
        say = [now.message, prep].filter(Boolean).join(" ")
        done.push({
          type: "NOW_PICK",
          kind: now.kind,
          options: now.options.map((o) => ({ id: o.sourceId, sourceType: o.sourceType, title: o.title, minutes: o.minutes, smaller: o.smaller, minimum: o.minimum })),
        })
      } else if (a.type === "SET_MODE" && MODES.includes(String(a.mode).toUpperCase() as Mode)) {
        const mode = String(a.mode).toUpperCase() as Mode
        const until = dayOnly(a.until)
        const set = await setModeService(userId, mode, until, "CHAT")
        say = MODE_SAY[mode]
        done.push({ type: "MODE_SET", mode, ...(until && mode !== "NORMAL" && { until }), activityId: set.activityId })
      } else if (a.type === "SET_SCHEDULE") {
        const days = strings(a.days, 7).map((d) => WEEKDAYS.indexOf(d.toUpperCase().slice(0, 3))).filter((d) => d >= 0)
        const set = await setScheduleService(userId, days, a.blocks, "CHAT")
        if (set) done.push({ type: "SCHEDULE_SET", days: set.weekdays.map((d) => WEEKDAYS[d]!), activityId: set.activityId })
      } else if (a.type === "ADD_HABIT" && a.title?.trim()) {
        if (habitTitles.has(norm(a.title))) {
          skipped++
          continue
        }
        const days = strings(a.days, 7).map((d) => d.toUpperCase().slice(0, 3)).filter((d) => ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].includes(d))
        const block = String(a.timeBlock ?? "").toUpperCase()
        const habit = await createHabitService(
          userId,
          {
            title: a.title.trim().slice(0, 200),
            areaId: await pickArea(userId, ctx, a.areaId),
            minimumVersion: a.minimum?.trim() || undefined,
            prepareAhead: a.prepare?.trim() || undefined,
            prepTime: clock(a.prepTime),
            timeBlock: ["MORNING", "COMMUTE", "OFFICE", "GYM", "EVENING", "NIGHT"].includes(block) ? (block as "MORNING") : undefined,
            frequency: days.length ? "CUSTOM" : "DAILY",
            specificDays: days.length ? (days as ("MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN")[]) : undefined,
            reminderTime: clock(a.reminderTime),
            anchor: a.anchor?.trim() || undefined,
            sizes: habitSizes(a.sizes),
          },
          { source: "CHAT" },
        )
        habitTitles.add(norm(habit.title))
        done.push({
          type: "HABIT_ADDED",
          id: habit.id,
          title: habit.title,
          ...(habit.timeBlock && { timeBlock: habit.timeBlock }),
          ...(habit.prepareAhead && { prep: habit.prepareAhead }),
          ...(habit.anchor && { anchor: habit.anchor }),
          ...(habitSizes(a.sizes) && { sizes: habitSizes(a.sizes) }),
          activityId: habit.activityId,
        })
      } else if (a.type === "ADD_PROJECT" && a.title?.trim()) {
        if (projectTitles.has(norm(a.title))) {
          skipped++
          continue
        }
        const kind = String(a.kind ?? "").toUpperCase()
        const deadlineKey = dayOnly(a.deadline)
        const priority = prio(a.priority) ?? "MEDIUM"
        const areaId = await pickArea(userId, ctx, a.areaId)
        const project = await createProjectService(
          userId,
          {
            title: a.title.trim().slice(0, 200),
            areaId,
            kind: ["OUTCOME", "MILESTONE", "PRACTICE", "WORK"].includes(kind) ? (kind as "WORK") : "WORK",
            why: a.why?.trim() || undefined,
            priority,
            deadline: deadlineKey ? dateFromKey(deadlineKey) : undefined,
            milestones: milestoneList(a.milestones),
            weeklyTargetMinutes: size(a.weeklyTargetMinutes) && kind === "PRACTICE" ? size(a.weeklyTargetMinutes) : undefined,
            metric: metricOf(a.metric, kind),
          },
          { source: "CHAT" },
        )
        projectTitles.add(norm(project.title))
        // The first to-dos inside the project inherit its priority and deadline.
        let tasks = 0
        for (const t of (Array.isArray(a.tasks) ? a.tasks : []).slice(0, 5)) {
          if (!t?.title?.trim() || openTitles.has(norm(t.title))) continue
          const dueKey = dayOnly(t.due) ?? deadlineKey
          await createTaskService(
            userId,
            {
              title: t.title.trim().slice(0, 200),
              projectId: project.id,
              areaId,
              dueDate: dueKey ? dateFromKey(dueKey) : undefined,
              priority: prio(t.priority) ?? priority,
              source: "DUMP",
            },
            { source: "CHAT" },
          )
          openTitles.add(norm(t.title))
          tasks++
        }
        done.push({
          type: "PROJECT_ADDED",
          id: project.id,
          title: project.title,
          kind: project.kind,
          ...(deadlineKey && { deadline: deadlineKey }),
          priority,
          tasks,
          activityId: project.activityId,
        })
      } else if (a.type === "ADD_NOTE" && (a.title?.trim() || a.collection?.trim())) {
        const template = String(a.template ?? "INFO").toUpperCase()
        const items = strings(a.items, 50)
        const text = a.text?.trim() || null
        if (!items.length && !text) continue
        const note = await createAllyNoteService(
          userId,
          {
            collection: (a.collection?.trim() || a.title!.trim()),
            template: (["LIST", "ROUTINE", "PLAYBOOK", "INFO"].includes(template) ? template : "INFO") as "LIST",
            title: (a.title?.trim() || a.collection!.trim()),
            items,
            text,
          },
          { source: "CHAT" },
        )
        done.push({
          type: "NOTE_ADDED",
          id: note.id,
          title: note.title,
          collection: note.collection,
          template: note.template,
          items: note.items,
          activityId: note.activityId,
        })
      }
    } catch (err) {
      logger.warn(`Chat action ${a.type} failed:`, err)
    }
  }
  return { done, say, skipped, asked }
}

// ---- entry ---------------------------------------------------------

export const assistantChat = async (
  userId: string,
  message: string,
  history: ChatTurn[] = [],
): Promise<ChatResult> => {
  const text = message.trim()

  // A shared link is a save: the app opens the save → action flow for it.
  const url = extractUrl(text)
  if (url && text.replace(url, "").trim().split(/\s+/).filter(Boolean).length <= 6) {
    return {
      role: "ASSISTANT",
      reply: "Saved it. Let's decide what it should change for you.",
      actions: [{ type: "OPEN_SAVE", text }],
      usedAi: false,
    }
  }

  if (isCrisis(text)) return { role: "FRIEND", reply: CRISIS_REPLY, actions: [], usedAi: false }

  const ctx = await loadContext(userId, text)
  const plan = await runWithAiFallback<Plan | null>(
    "Assistant chat",
    {
      groq: groqClient ? () => planWithGroq(ctx, text, history) : undefined,
      gemini: geminiClient ? () => planWithGemini(ctx, text, history) : undefined,
    },
    () => null,
  )

  const backup = nudgeRequest(text)

  if (!plan) {
    // No AI available. A plain nudge request still works; anything else goes
    // to the older router (what-now / capture / knowledge), without actions.
    if (backup) {
      const { done } = await execute(userId, ctx, [backup])
      const on = backup.time ? `on, every ${backup.kind === "MORNING" ? "morning" : "night"} at ${backup.time}` : "off"
      return { role: "ASSISTANT", reply: done.length ? `Done. Nudge is ${on}.` : "That didn't go through. Please try again.", actions: done, usedAi: false }
    }
    const old = await assistantAsk(userId, text, history)
    return { role: "ASSISTANT", reply: old.answer, actions: [], usedAi: false }
  }

  if (backup) {
    // A clear nudge request is applied exactly as parsed; whatever the model
    // planned for it (a reminder, a malformed nudge) is replaced.
    plan.actions = [...plan.actions.filter((a) => a.type !== "SET_REMINDER" && a.type !== "SET_NUDGE"), backup]
  }
  // Venting is not a to-do list: in FRIEND mode nothing is created unless
  // they explicitly asked for it.
  if (plan.role === "FRIEND" && !EXPLICIT_TASK.test(text)) {
    plan.actions = plan.actions.filter((a) => !CREATES.has(a.type ?? ""))
  }
  const { done: actions, say, skipped, asked } = await execute(userId, ctx, plan.actions, text)
  const [forgotten, remembered] = await Promise.all([
    forgetMemories(userId, plan.forget, ctx.memories).catch(() => []),
    saveMemories(userId, plan.remember, ctx.memories).catch(() => []),
  ])
  const memoryActions: ChatAction[] = [
    ...forgotten.map((m) => ({ type: "FORGOT" as const, id: m.id, text: m.content, activityId: m.activityId })),
    ...remembered.map((m) => ({ type: "REMEMBERED" as const, id: m.id, text: m.content, activityId: m.activityId })),
  ]
  // The reply was written before anything ran. If an action didn't go
  // through, say so rather than let the reply claim it did.
  const attempted = plan.actions.filter((a) => a.type && a.type !== "NONE").length - skipped - (asked ? 1 : 0)
  const notes = [
    contentRedirect(text, ctx.patterns, plan.reply),
    actions.length < attempted ? "(One change didn't go through. Please try again.)" : null,
  ].filter(Boolean)
  // An ambiguous completion: the question replaces a reply that may have said "done".
  const reply = asked
    ? `Which one did you finish: ${asked.options.map((o) => `"${o.title}"`).join(" or ")}?`
    : say
      ? [say, ...notes].join("\n\n")
      : [plan.reply, ...notes].join("\n\n")
  // Capacity guard: never silently overload today (plan rule 6).
  let capacity: ChatResult["capacity"]
  if (actions.some((x) => x.type === "TASK_ADDED" || x.type === "PROJECT_ADDED")) {
    const cap = await capacityTodayService(userId).catch(() => null)
    if (cap?.over) {
      capacity = {
        message: cap.message,
        plannedMinutes: cap.plannedMinutes,
        freeMinutes: cap.freeMinutes,
        keep: cap.keep.map((id) => ({ id, title: cap.titles[id] ?? "" })),
        move: cap.move.map((id) => ({ id, title: cap.titles[id] ?? "" })),
      }
    }
  }
  const have = new Set(ctx.habits.map((h) => norm(h.title)))
  const suggestions = plan.suggest.filter((s) => !have.has(norm(s.title)))
  return {
    role: plan.role,
    reply: capacity ? `${reply}\n\n${capacity.message}` : reply,
    actions: [...(asked ? [asked] : []), ...actions, ...memoryActions],
    ...(capacity && { capacity }),
    ...(suggestions.length && { suggestions }),
    usedAi: true,
  }
}
