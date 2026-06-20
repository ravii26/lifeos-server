import { geminiClient } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { computeHabitStats } from "../habit/habit.stats.js"
import { scoreArea, type ScoringInput } from "../area/area.scoring.js"
import type { findDecisionContext } from "./decisions.repository.js"
import logger from "../../lib/logger.js"
import { env } from "../../config/env.config.js"

type RawContext = Awaited<ReturnType<typeof findDecisionContext>>

export type SuggestionType = "TASK" | "HABIT" | "AREA_FOCUS" | "REVIEW" | "GOAL"
export type Urgency = "HIGH" | "MEDIUM" | "LOW"

export interface Suggestion {
  rank: number
  type: SuggestionType
  refId: string | null
  title: string
  reason: string
  urgency: Urgency
  actionableSteps: string[]  // 1-3 concrete next micro-actions
}

export interface StreakAlert {
  habitId: string
  title: string
  streakDays: number
  message: string
}

export type Tone = "encouraging" | "firm" | "celebratory" | "neutral"

// The single most important thing to do right now — drives the hero card.
export interface PrimaryAction {
  type: SuggestionType
  refId: string | null
  title: string
  why: string                 // one human sentence: why THIS, right now
  estimatedMinutes: number | null
}

export interface DecisionResult {
  headline: string             // punchy human one-liner for the top of the screen
  briefing: string             // 2-3 sentence coach-style narrative tying it together
  tone: Tone                   // lets the UI theme the card (color/emoji/voice)
  primaryAction: PrimaryAction | null  // the ONE thing — hero CTA
  suggestions: Suggestion[]
  neglectedArea: { id: string; name: string; score: number; insight: string } | null
  todayFocus: string
  behaviorInsight: string
  weeklyPattern: string        // observation about which days/activities dominate
  streakAlerts: StreakAlert[]  // habits with streaks at risk today
  generatedAt: Date
  source: "ai" | "heuristic"
}

// ── Build a lean context summary for the Gemini prompt ───────────────────────

const hourOfDay = (): string => {
  const h = new Date().getUTCHours()
  if (h < 6) return "night"
  if (h < 12) return "morning"
  if (h < 17) return "afternoon"
  return "evening"
}

const todayKey = (): string => new Date().toISOString().slice(0, 10)

interface ContextSummary {
  timeOfDay: string
  areas: { id: string; name: string; score: number; tasksDone: number; tasksTotal: number; streak: number }[]
  topPendingTasks: { id: string; title: string; priority: string; daysOverdue: number | null; areaName: string | null; targetMinutes: number | null }[]
  habitsNotDoneToday: { id: string; title: string; areaName: string | null; currentStreak: number; targetMinutes: number | null }[]
  activeGoals: { id: string; title: string; areaName: string | null; daysUntilDeadline: number | null }[]
  recentActivity: { tasksCompleted7d: number; habitsLogged7d: number; focusSessions7d: number; mostActiveAreaId: string | null }
  identity: { purpose: string | null; thisYearGoal: string | null; values: string[] }
  streakAlerts: StreakAlert[]
  weeklyPattern: string
}

const buildContextSummary = (raw: RawContext): ContextSummary => {
  const areaMap = new Map(raw.areas.map((a) => [a.id, a.name]))
  const tk = todayKey()
  const now = new Date()

  // Compute area scores
  const scoringInput: ScoringInput = {
    tasks: raw.pendingTasks.map((t) => ({ areaId: t.areaId, status: t.status })),
    habits: raw.habits.map((h) => ({
      areaId: h.areaId,
      logs: h.logs.map((l) => ({ date: l.date, completed: l.completed, minutes: 0 })),
    })),
    resources: [],
  }

  const areas = raw.areas.map((a) => {
    const scored = scoreArea(a.id, scoringInput)
    return {
      id: a.id,
      name: a.name,
      score: scored.score,
      tasksDone: scored.tasksDone,
      tasksTotal: scored.tasksTotal,
      streak: scored.streak,
    }
  })

  // Compute habit stats once, reuse for both notDoneToday and streakAlerts
  const habitStatsList = raw.habits.map((h) => {
    const stats = computeHabitStats(h.logs)
    const todayDone = h.logs.some((l) => l.date.toISOString().slice(0, 10) === tk && l.completed)
    return { habit: h, stats, todayDone }
  })

  const habitsNotDoneToday = habitStatsList
    .filter((h) => !h.todayDone)
    .map(({ habit, stats }) => ({
      id: habit.id,
      title: habit.title,
      areaName: areaMap.get(habit.areaId) ?? null,
      currentStreak: stats.currentStreak,
      targetMinutes: habit.targetMinutes ?? null,
    }))

  const streakAlertsFixed: StreakAlert[] = habitStatsList
    .filter((h) => !h.todayDone && h.stats.currentStreak >= 3)
    .map(({ habit, stats }) => ({
      habitId: habit.id,
      title: habit.title,
      streakDays: stats.currentStreak,
      message: `${stats.currentStreak}-day streak — log today to keep it alive!`,
    }))

  // Top pending tasks with overdue info
  const topPendingTasks = raw.pendingTasks.slice(0, 10).map((t) => {
    const daysOverdue = t.dueDate
      ? Math.floor((now.getTime() - new Date(t.dueDate).getTime()) / 86_400_000)
      : null
    return {
      id: t.id,
      title: t.title,
      priority: t.priority,
      daysOverdue: daysOverdue !== null && daysOverdue > 0 ? daysOverdue : null,
      areaName: t.areaId ? (areaMap.get(t.areaId) ?? null) : null,
      targetMinutes: t.targetMinutes ?? null,
    }
  })

  // Goals with deadline proximity
  const activeGoals = raw.activeGoals.slice(0, 5).map((g) => {
    const daysUntilDeadline = g.deadline
      ? Math.floor((new Date(g.deadline).getTime() - now.getTime()) / 86_400_000)
      : null
    return {
      id: g.id,
      title: g.title,
      areaName: g.areaId ? (areaMap.get(g.areaId) ?? null) : null,
      daysUntilDeadline,
    }
  })

  // Recent activity counts
  let tasksCompleted7d = 0
  let habitsLogged7d = 0
  let focusSessions7d = 0

  // Day-of-week activity map (0=Sun ... 6=Sat)
  const dayActivity: number[] = [0, 0, 0, 0, 0, 0, 0]

  for (const log of raw.recentBehavior) {
    if (log.eventType === "TASK_COMPLETED") tasksCompleted7d++
    if (log.eventType === "HABIT_LOGGED") habitsLogged7d++
    if (log.eventType === "FOCUS_COMPLETED") focusSessions7d++
    const day = new Date(log.occurredAt).getDay()
    dayActivity[day]++
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const busiestDay = dayActivity.indexOf(Math.max(...dayActivity))
  const quietestDay = dayActivity.indexOf(Math.min(...dayActivity))
  const weeklyPattern =
    dayActivity.every((d) => d === 0)
      ? "No activity logged in the past 7 days."
      : `Most active on ${dayNames[busiestDay]}; least active on ${dayNames[quietestDay]}. ${tasksCompleted7d} tasks and ${habitsLogged7d} habits logged this week.`

  const mostActiveAreaId = raw.areas[0]?.id ?? null

  return {
    timeOfDay: hourOfDay(),
    areas,
    topPendingTasks,
    habitsNotDoneToday,
    activeGoals,
    recentActivity: { tasksCompleted7d, habitsLogged7d, focusSessions7d, mostActiveAreaId },
    identity: {
      purpose: raw.identity?.purpose ?? null,
      thisYearGoal: raw.identity?.thisYearGoal ?? null,
      values: raw.identity?.values ?? [],
    },
    streakAlerts: streakAlertsFixed,
    weeklyPattern,
  }
}

// Prefer the entity's real targetMinutes; fall back to type-based defaults.
const estimateMinutesFor = (
  type: SuggestionType,
  refId: string | null,
  ctx: ContextSummary,
): number | null => {
  if (type === "TASK") {
    return ctx.topPendingTasks.find((t) => t.id === refId)?.targetMinutes ?? 25
  }
  if (type === "HABIT") {
    return ctx.habitsNotDoneToday.find((h) => h.id === refId)?.targetMinutes ?? 10
  }
  return null
}

// ── Heuristic fallback ────────────────────────────────────────────────────────

const heuristicDecision = (ctx: ContextSummary): DecisionResult => {
  const suggestions: Suggestion[] = []

  // 1. Overdue tasks first
  const overdueTasks = ctx.topPendingTasks.filter((t) => (t.daysOverdue ?? 0) > 0)
  for (const t of overdueTasks.slice(0, 2)) {
    suggestions.push({
      rank: suggestions.length + 1,
      type: "TASK",
      refId: t.id,
      title: t.title,
      reason: `Overdue by ${t.daysOverdue} day(s) — complete this to clear the backlog.`,
      urgency: "HIGH",
      actionableSteps: ["Open the task", "Spend 25 minutes on it (Pomodoro)", "Mark complete"],
    })
  }

  // 2. High priority tasks
  const highTasks = ctx.topPendingTasks.filter(
    (t) => (t.priority === "CRITICAL" || t.priority === "HIGH") && !t.daysOverdue,
  )
  for (const t of highTasks.slice(0, 2)) {
    suggestions.push({
      rank: suggestions.length + 1,
      type: "TASK",
      refId: t.id,
      title: t.title,
      reason: "High priority task — doing this moves the needle on your goals.",
      urgency: "HIGH",
      actionableSteps: ["Block 30 minutes now", "Start with the hardest part first", "Mark complete"],
    })
  }

  // 3. Streak-at-risk habits first, then all remaining
  const sortedHabits = [...ctx.habitsNotDoneToday].sort(
    (a, b) => b.currentStreak - a.currentStreak,
  )
  for (const h of sortedHabits.slice(0, 2)) {
    const streakNote = h.currentStreak > 0 ? ` Protect your ${h.currentStreak}-day streak.` : ""
    suggestions.push({
      rank: suggestions.length + 1,
      type: "HABIT",
      refId: h.id,
      title: `Log: ${h.title}`,
      reason: `Not done today.${streakNote}`,
      urgency: h.currentStreak > 2 ? "HIGH" : "MEDIUM",
      actionableSteps: ["Do it now (even the minimum counts)", "Log it in the app"],
    })
  }

  // 4. Neglected area
  const neglected = [...ctx.areas].sort((a, b) => a.score - b.score)[0]
  if (neglected && neglected.score < 40) {
    suggestions.push({
      rank: suggestions.length + 1,
      type: "AREA_FOCUS",
      refId: neglected.id,
      title: `Focus on: ${neglected.name}`,
      reason: `Score is ${neglected.score}/100 — this area needs attention.`,
      urgency: neglected.score < 20 ? "HIGH" : "MEDIUM",
      actionableSteps: [
        `Complete one task in ${neglected.name}`,
        `Log one habit in ${neglected.name}`,
        "Take a snapshot to track progress",
      ],
    })
  }

  const neglectedArea = neglected && neglected.score < 50
    ? {
      id: neglected.id,
      name: neglected.name,
      score: neglected.score,
      insight: `Only ${neglected.tasksDone}/${neglected.tasksTotal} tasks done and ${neglected.streak}-day habit streak.`,
    }
    : null

  const topTask = ctx.topPendingTasks[0]
  const todayFocus = topTask
    ? `Focus on "${topTask.title}" — it's your highest-priority pending task.`
    : "No pending tasks — a great day to review your goals or reflect on your progress."

  const { tasksCompleted7d, habitsLogged7d } = ctx.recentActivity
  const behaviorInsight =
    tasksCompleted7d === 0 && habitsLogged7d === 0
      ? "No tasks or habits logged in the last 7 days — the system needs your attention."
      : `You've completed ${tasksCompleted7d} task(s) and logged ${habitsLogged7d} habit(s) this week. Keep the momentum going.`

  // ── Derive the coach-style top layer from the ranked suggestions ──
  const top = suggestions[0] ?? null

  const primaryAction: PrimaryAction | null = top
    ? {
      type: top.type,
      refId: top.refId,
      title: top.title,
      why: top.reason,
      estimatedMinutes: estimateMinutesFor(top.type, top.refId, ctx),
    }
    : null

  let tone: Tone
  let headline: string
  let briefing: string

  const idle = tasksCompleted7d === 0 && habitsLogged7d === 0
  const hasOverdue = overdueTasks.length > 0
  const atRiskStreaks = ctx.streakAlerts.length

  if (!top) {
    tone = "celebratory"
    headline = "You're all caught up — nice work."
    briefing =
      "Nothing urgent is on your plate right now. This is the perfect window to review your goals or reflect on the week before new work piles up."
  } else if (hasOverdue) {
    tone = "firm"
    headline = `${overdueTasks.length} thing${overdueTasks.length > 1 ? "s" : ""} slipped past due — let's clear the decks.`
    briefing =
      `Start with "${top.title}". ${atRiskStreaks > 0 ? `You also have ${atRiskStreaks} habit streak${atRiskStreaks > 1 ? "s" : ""} on the line today. ` : ""}Knock out the overdue item first, then keep the streaks alive.`
  } else if (idle) {
    tone = "encouraging"
    headline = "Quiet week so far — one small win restarts the momentum."
    briefing =
      `It's been quiet for 7 days. Don't aim for everything — just do "${top.title}". One completion is all it takes to get the flywheel turning again.`
  } else {
    tone = "encouraging"
    headline = `Your ${ctx.timeOfDay}: start with "${top.title}".`
    briefing =
      `You're ${tasksCompleted7d + habitsLogged7d} actions deep this week. ${atRiskStreaks > 0 ? `Protect your streak${atRiskStreaks > 1 ? "s" : ""} today, then ` : "Now "}focus on the one thing above — it moves the needle most right now.`
  }

  return {
    headline,
    briefing,
    tone,
    primaryAction,
    suggestions: suggestions.slice(0, 5),
    neglectedArea,
    todayFocus,
    behaviorInsight,
    weeklyPattern: ctx.weeklyPattern,
    streakAlerts: ctx.streakAlerts,
    generatedAt: new Date(),
    source: "heuristic",
  }
}

// ── Gemini prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the executive advisor AI of LifeOS, a personal operating system.
Your goal is to analyze the user's current state and recommend exactly what they should focus on next to achieve their goals, build consistent habits, and maintain balanced life areas.

You will receive a JSON snapshot of the user's current context: area scores, pending tasks, incomplete daily habits, active goals, recent behavior patterns, and core identity traits (purpose, values, yearly goals).

<rules>
1. Output raw JSON only. Do NOT format with markdown code blocks (e.g. \`\`\`json).
2. Recommendations must be highly specific, directly naming tasks or habits in the context. Avoid generic or high-level advice.
3. Be direct and honest. If the user is neglecting an area or falling behind on habits, state it clearly.
4. Urgency/Priority hierarchy:
   - Overdue tasks
   - Incomplete habits with active streaks (highest streak first)
   - High-priority tasks
   - Goals with approaching deadlines
   - Neglected life areas (low scores)
5. Include 1-3 concrete next steps for each recommendation (short, actionable phrases of max 10 words each).
6. If the user's dashboard is completely clear, recommend reviewing active goals or performing a reflection.
7. VOICE: Write "headline" and "briefing" like a sharp, warm human coach talking directly to the user — second person ("you"), specific, never corporate or generic. The headline is a punchy one-liner (max ~12 words). The briefing is 2-3 sentences that tie their state together and point at the one thing that matters most. Reference the time of day where natural.
8. "primaryAction" is the single most important thing to do RIGHT NOW. It must correspond to suggestions[0]. Set "estimatedMinutes" to a realistic effort estimate (habits ~5-15, tasks ~25-45) or null if unknowable.
9. "tone" must match reality: "celebratory" when caught up / on a hot streak, "firm" when overdue or slipping, "encouraging" when restarting momentum, "neutral" otherwise.
</rules>

<output_schema>
{
  "headline": "string", // Punchy human one-liner for the top of the screen, max ~12 words
  "briefing": "string", // 2-3 sentence coach-style narrative tying their state together
  "tone": "encouraging" | "firm" | "celebratory" | "neutral",
  "primaryAction": {
    "type": "TASK" | "HABIT" | "AREA_FOCUS" | "REVIEW" | "GOAL",
    "refId": "string" | null, // ID of the referenced entity; must match suggestions[0].refId
    "title": "string", // The one thing to do now
    "why": "string", // One human sentence: why THIS, right now
    "estimatedMinutes": number | null
  } | null, // null only when there is genuinely nothing to do
  "suggestions": [
    {
      "rank": number, // 1 to 5 sequential recommendation rank
      "type": "TASK" | "HABIT" | "AREA_FOCUS" | "REVIEW" | "GOAL",
      "refId": "string" | null, // ID of the referenced task, habit, area, or goal (null for REVIEW)
      "title": "string", // Concise, action-oriented title (e.g., "Complete task: draft report")
      "reason": "string", // Single sentence explaining why this is prioritized right now
      "urgency": "HIGH" | "MEDIUM" | "LOW",
      "actionableSteps": string[] // 1 to 3 micro-actions the user can perform immediately
    }
  ],
  "neglectedArea": {
    "id": "string",
    "name": "string",
    "score": number,
    "insight": "string" // Explains why this area is falling behind and what to focus on
  } | null,
  "todayFocus": "string", // One-sentence summary highlighting the single most important target for today
  "behaviorInsight": "string" // Pattern observation or encouragement based on the user's recent 7-day behavior log
}
</output_schema>`

// Shared shape the model returns, and a single place to normalize it into a
// DecisionResult (fills coach fields / primaryAction if the model omits them).
interface ParsedAiDecision {
  headline?: string
  briefing?: string
  tone?: Tone
  primaryAction?: PrimaryAction | null
  suggestions: Suggestion[]
  neglectedArea: { id: string; name: string; score: number; insight: string } | null
  todayFocus: string
  behaviorInsight: string
}

const finalizeAiDecision = (parsed: ParsedAiDecision, ctx: ContextSummary): DecisionResult => {
  // Ensure actionableSteps always exists (older prompts may omit it)
  const suggestions = parsed.suggestions.slice(0, 5).map((s) => ({
    ...s,
    actionableSteps: Array.isArray(s.actionableSteps) ? s.actionableSteps : [],
  }))

  const top = suggestions[0] ?? null

  // Fall back to suggestions[0] if the model didn't return a primaryAction.
  // Either way, trust the entity's real targetMinutes over the model's guess
  // when we have it (model estimate is only used if no entity match exists).
  const base = parsed.primaryAction ?? (top
    ? { type: top.type, refId: top.refId, title: top.title, why: top.reason, estimatedMinutes: null }
    : null)

  const primaryAction: PrimaryAction | null = base
    ? {
      ...base,
      estimatedMinutes: estimateMinutesFor(base.type, base.refId, ctx) ?? base.estimatedMinutes ?? null,
    }
    : null

  return {
    headline: parsed.headline?.trim() || (top ? `Start with "${top.title}".` : "You're all caught up."),
    briefing: parsed.briefing?.trim() || parsed.todayFocus || "",
    tone: parsed.tone ?? "neutral",
    primaryAction,
    suggestions,
    neglectedArea: parsed.neglectedArea ?? null,
    todayFocus: parsed.todayFocus ?? "",
    behaviorInsight: parsed.behaviorInsight ?? "",
    weeklyPattern: ctx.weeklyPattern,
    streakAlerts: ctx.streakAlerts,
    generatedAt: new Date(),
    source: "ai",
  }
}

const geminiGetDecisions = async (ctx: ContextSummary): Promise<DecisionResult> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")

  try {
    const model = geminiClient.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { responseMimeType: "application/json" },
    })

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: `User context: ${JSON.stringify(ctx)}` },
    ])

    const parsed = JSON.parse(result.response.text()) as ParsedAiDecision

    if (!parsed || !Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
      throw new Error("Empty suggestions from Gemini")
    }

    return finalizeAiDecision(parsed, ctx)
  } catch (error) {
    logger.error("Gemini decisions generation failed:", error)
    throw error
  }
}

const groqGetDecisions = async (ctx: ContextSummary): Promise<DecisionResult> => {
  if (!groqClient) throw new Error("Groq client not initialized")

  try {
    const response = await groqClient.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `User context: ${JSON.stringify(ctx)}` },
      ],
      model: "openai/gpt-oss-120b",
      response_format: { type: "json_object" },
    })

    const text = response.choices[0]?.message?.content || ""
    const parsed = JSON.parse(text) as ParsedAiDecision

    if (!parsed || !Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
      throw new Error("Empty suggestions from Groq")
    }

    return finalizeAiDecision(parsed, ctx)
  } catch (error) {
    logger.error("Groq decisions generation failed:", error)
    throw error
  }
}

export const getDecisions = async (raw: RawContext): Promise<DecisionResult> => {
  const ctx = buildContextSummary(raw)

  const preferred = env.PREFERRED_AI_PROVIDER
  const providers = preferred === "groq" ? ["groq", "gemini"] : ["gemini", "groq"]

  for (const provider of providers) {
    if (provider === "gemini" && geminiClient) {
      try {
        return await geminiGetDecisions(ctx)
      } catch (err) {
        logger.warn("Falling back from Gemini decisions generator...")
      }
    }
    if (provider === "groq" && groqClient) {
      try {
        return await groqGetDecisions(ctx)
      } catch (err) {
        logger.warn("Falling back from Groq decisions generator...")
      }
    }
  }

  logger.info("Using heuristic decisions generator fallback")
  return { ...heuristicDecision(ctx), source: "heuristic" }
}
