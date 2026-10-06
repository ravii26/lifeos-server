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
import { logHabitService } from "../habit/habit.service.js"
import { getTonightService } from "../guide/guide.service.js"
import { extractUrl } from "../guide/guide.saves.ai.js"
import { upsertSettings } from "../settings/settings.repository.js"
import { recordActivity } from "../activity/activity.service.js"
import { loadPatternFacts, detectPatterns } from "./assistant.patterns.js"
import { recallMemories, saveMemories, forgetMemories, type MemoryWrite } from "./assistant.memory.js"
import { assistantAsk } from "./assistant.service.js"
import { todayKeyInTz, localDayStartMs, weekdayInTz, dateFromKey } from "../../shared/utils/time.util.js"
import logger from "../../lib/logger.js"

export type ChatTurn = { role: "user" | "assistant"; text: string }

// activityId lets the app offer Undo for the action (see /activity/:id/undo).
export type ChatAction = (
  | { type: "TASK_ADDED"; id: string; title: string }
  | { type: "TASK_COMPLETED"; id: string; title: string }
  | { type: "HABIT_LOGGED"; id: string; title: string }
  | { type: "REMINDER_SET"; id: string; text: string; remindAt: string }
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
  usedAi: boolean
}

// ---- context -------------------------------------------------------

const loadContext = async (userId: string, message: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true, name: true } })
  const timeZone = user?.timezone ?? "Asia/Kolkata"
  const todayKey = todayKeyInTz(timeZone)
  const [areas, tasks, habits, reminders, identity, tonight, settings, memories, patternFacts] = await Promise.all([
    prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true, tier: true } }),
    prisma.task.findMany({
      where: { userId, status: { in: ["TODO", "IN_PROGRESS"] } },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 40,
      select: { id: true, title: true, dueDate: true, areaId: true },
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true },
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
  ])
  return {
    timeZone,
    todayKey,
    name: user?.name ?? "",
    areas,
    tasks,
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
- {"type":"ADD_TASK","title":string,"minimum":string|null,"areaId":string|null,"due":"YYYY-MM-DD"|null}
- {"type":"COMPLETE_TASK","taskId":string}
- {"type":"LOG_HABIT","habitId":string}
- {"type":"SET_REMINDER","text":string,"at":"YYYY-MM-DDTHH:mm"}   (local time; resolve "at 7" / "tomorrow" / "in 2 hours" from "now")
- {"type":"SET_NUDGE","kind":"NIGHTLY"|"MORNING","time":"HH:mm"|null}   (null turns it off)

Action rules:
- "What should I do now?" or similar: answer with tonightsOneThing (title + one-line why). If it is done, suggest one open task from a MAIN or SECONDARY area.
- When they say they finished something, complete the matching task or habit.
- When they ask to be reminded, set a reminder. When they clearly mention something they need to do, add a task (ask nothing unless truly unclear).
- You never message them on your own. Only when they ask ("nudge me every night at 9:30", "stop the nightly reminders") set or clear a nudge with SET_NUDGE.
- When they vent or share their day, do not turn it into tasks unless they ask.

Memory:
- whatYouRemember is what you already know about them. Use it naturally so they never repeat themselves; don't recite it back.
- Each remember item also has "source": "SAID" if they told you directly, "INFERRED" if you concluded it; and "sensitive": true for health or mental-health details (those are never brought up unless they raise them).
- remember: up to 3 NEW durable things worth knowing later: their schedule, goals, struggles, preferences, people in their life, notable events, or how they felt (include the date for feelings/events, e.g. "Felt drained on 5 Oct after manager changed priorities"). Short, third person. Never save tasks/reminders (those are actions), small talk, or anything already in whatYouRemember.
- kind: FACT | PREFERENCE | GOAL | STRUGGLE | FEELING | PERSON | EVENT. importance: 1 minor, 2 useful, 3 core to who they are.
- forget: ids from whatYouRemember to delete, when they ask you to forget something or it is no longer true (then remember the corrected version).
- When they ask what you know about them, answer from whatYouRemember.

Return JSON only: {"role": "FRIEND"|"ASSISTANT"|"MENTOR"|"COACH"|"GUIDE", "reply": string, "actions": [ ... ], "remember": [{"content": string, "kind": string, "importance": number, "source": "SAID"|"INFERRED", "sensitive": boolean}], "forget": [string]}`

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
}

export const ROLES = ["FRIEND", "ASSISTANT", "MENTOR", "COACH", "GUIDE"] as const
export type ChatRole = (typeof ROLES)[number]

interface Plan {
  role: ChatRole
  reply: string
  actions: PlannedAction[]
  remember: MemoryWrite[]
  forget: unknown[]
}

const parsePlan = (raw: string): Plan => {
  const p = JSON.parse(raw) as { role?: unknown; reply?: unknown; actions?: unknown; remember?: unknown; forget?: unknown }
  const reply = typeof p.reply === "string" ? p.reply.trim() : ""
  if (!reply) throw new Error("Chat AI returned no reply")
  return {
    role: ROLES.includes(p.role as ChatRole) ? (p.role as ChatRole) : "ASSISTANT",
    reply: reply.slice(0, 1200),
    actions: Array.isArray(p.actions) ? (p.actions as PlannedAction[]).slice(0, 5) : [],
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

const EXPLICIT_TASK = /\b(add|task|remind|to-?do|todo|put .* on my list|note (it|that) down)\b/i

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

const LOCAL_DT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/

// "2026-10-05T19:00" in the user's zone → a UTC instant.
export const localToUtc = (local: string, timeZone: string): Date | null => {
  const m = local.match(LOCAL_DT)
  if (!m) return null
  const [, key, hh, mm] = m
  const ms = localDayStartMs(key!, timeZone) + (Number(hh) * 60 + Number(mm)) * 60_000
  return Number.isFinite(ms) ? new Date(ms) : null
}

const execute = async (userId: string, ctx: Ctx, planned: PlannedAction[]): Promise<ChatAction[]> => {
  const done: ChatAction[] = []
  const taskIds = new Map(ctx.tasks.map((t) => [t.id, t.title]))
  const habitIds = new Map(ctx.habits.map((h) => [h.id, h.title]))
  const areaIds = new Set(ctx.areas.map((a) => a.id))

  for (const a of planned) {
    try {
      if (a.type === "ADD_TASK" && a.title?.trim()) {
        const due = a.due && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? dateFromKey(a.due) : undefined
        const task = await createTaskService(
          userId,
          {
            title: a.title.trim().slice(0, 200),
            minimumVersion: a.minimum?.trim() || undefined,
            areaId: a.areaId && areaIds.has(a.areaId) ? a.areaId : undefined,
            dueDate: due,
            source: "DUMP",
          },
          { source: "CHAT" },
        )
        done.push({ type: "TASK_ADDED", id: task.id, title: task.title, activityId: task.activityId })
      } else if (a.type === "COMPLETE_TASK" && a.taskId && taskIds.has(a.taskId)) {
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
        // A reminder is a to-do with a time.
        const task = await createTaskService(
          userId,
          { title: a.text.trim().slice(0, 200), remindAt: at, dueDate: at, source: "REMINDER" },
          { source: "CHAT" },
        )
        done.push({
          type: "REMINDER_SET",
          id: task.id,
          text: task.title,
          remindAt: at.toISOString(),
          activityId: task.activityId,
        })
      }
    } catch (err) {
      logger.warn(`Chat action ${a.type} failed:`, err)
    }
  }
  return done
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
      const actions = await execute(userId, ctx, [backup])
      const on = backup.time ? `on, every ${backup.kind === "MORNING" ? "morning" : "night"} at ${backup.time}` : "off"
      return { role: "ASSISTANT", reply: actions.length ? `Done. Nudge is ${on}.` : "That didn't go through. Please try again.", actions, usedAi: false }
    }
    const old = await assistantAsk(userId, text, history)
    return { role: "ASSISTANT", reply: old.answer, actions: [], usedAi: false }
  }

  if (backup) {
    // A clear nudge request is applied exactly as parsed; whatever the model
    // planned for it (a reminder, a malformed nudge) is replaced.
    plan.actions = [...plan.actions.filter((a) => a.type !== "SET_REMINDER" && a.type !== "SET_NUDGE"), backup]
  }
  // Venting is not a to-do list: in FRIEND mode nothing becomes a task unless
  // they explicitly asked for one.
  if (plan.role === "FRIEND" && !EXPLICIT_TASK.test(text)) {
    plan.actions = plan.actions.filter((a) => a.type !== "ADD_TASK")
  }
  const actions = await execute(userId, ctx, plan.actions)
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
  const attempted = plan.actions.filter((a) => a.type && a.type !== "NONE").length
  const notes = [
    contentRedirect(text, ctx.patterns, plan.reply),
    actions.length < attempted ? "(One change didn't go through. Please try again.)" : null,
  ].filter(Boolean)
  const reply = [plan.reply, ...notes].join("\n\n")
  return { role: plan.role, reply, actions: [...actions, ...memoryActions], usedAi: true }
}
