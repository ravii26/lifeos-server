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

export interface DecisionResult {
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
  topPendingTasks: { id: string; title: string; priority: string; daysOverdue: number | null; areaName: string | null }[]
  habitsNotDoneToday: { id: string; title: string; areaName: string | null; currentStreak: number }[]
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

  return {
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
</rules>

<output_schema>
{
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

    const parsed = JSON.parse(result.response.text()) as {
      suggestions: Suggestion[]
      neglectedArea: { id: string; name: string; score: number; insight: string } | null
      todayFocus: string
      behaviorInsight: string
    }

    if (!parsed || !Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
      throw new Error("Empty suggestions from Gemini")
    }

    // Ensure actionableSteps always exists (older prompts may omit it)
    const suggestions = parsed.suggestions.slice(0, 5).map((s) => ({
      ...s,
      actionableSteps: Array.isArray(s.actionableSteps) ? s.actionableSteps : [],
    }))

    return {
      suggestions,
      neglectedArea: parsed.neglectedArea ?? null,
      todayFocus: parsed.todayFocus ?? "",
      behaviorInsight: parsed.behaviorInsight ?? "",
      weeklyPattern: ctx.weeklyPattern,
      streakAlerts: ctx.streakAlerts,
      generatedAt: new Date(),
      source: "ai",
    }
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
    const parsed = JSON.parse(text) as {
      suggestions: Suggestion[]
      neglectedArea: { id: string; name: string; score: number; insight: string } | null
      todayFocus: string
      behaviorInsight: string
    }

    if (!parsed || !Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
      throw new Error("Empty suggestions from Groq")
    }

    // Ensure actionableSteps always exists (older prompts may omit it)
    const suggestions = parsed.suggestions.slice(0, 5).map((s) => ({
      ...s,
      actionableSteps: Array.isArray(s.actionableSteps) ? s.actionableSteps : [],
    }))

    return {
      suggestions,
      neglectedArea: parsed.neglectedArea ?? null,
      todayFocus: parsed.todayFocus ?? "",
      behaviorInsight: parsed.behaviorInsight ?? "",
      weeklyPattern: ctx.weeklyPattern,
      streakAlerts: ctx.streakAlerts,
      generatedAt: new Date(),
      source: "ai",
    }
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
