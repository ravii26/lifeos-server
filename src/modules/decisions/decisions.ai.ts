import { geminiClient } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { computeHabitStats } from "../habit/habit.stats.js"
import { scoreArea, type ScoringInput } from "../area/area.scoring.js"
import { scoreGoalConfidence } from "../goal/goal.confidence.js"
import { dayKeyInTz, timeOfDayLabel, utcDayKey } from "../../shared/utils/time.util.js"
import type { findDecisionContext } from "./decisions.repository.js"
import type { CalendarBlockDto } from "../calendar/calendar.dto.js"
import logger from "../../lib/logger.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"

type RawContext = Awaited<ReturnType<typeof findDecisionContext>>

export type SuggestionType =
  | "TASK"
  | "HABIT"
  | "AREA_FOCUS"
  | "REVIEW"
  | "GOAL"
  | "PROJECT"
  | "CAPTURE"
  | "RESOURCE"
  | "VAULT"
  | "NOTE"
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

// Today's time-blocked schedule, so the engine can recommend the right thing
// for RIGHT NOW (what you're time-blocked into, or what's coming up next).
export interface ScheduleInfo {
  current: {
    title: string
    blockType: string
    areaName: string | null
    endsAt: string // local "HH:MM"
  } | null
  next: {
    title: string
    blockType: string
    areaName: string | null
    startsAt: string // local "HH:MM"
  } | null
  todayCount: number
}

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
  schedule: ScheduleInfo       // today's calendar: what's on now / next
  generatedAt: Date
  source: "ai" | "heuristic"
}

// ── Build a lean context summary for the Gemini prompt ───────────────────────

interface ContextSummary {
  timeOfDay: string
  areas: { id: string; name: string; score: number; tasksDone: number; tasksTotal: number; streak: number }[]
  topPendingTasks: { id: string; title: string; priority: string; daysOverdue: number | null; areaName: string | null; targetMinutes: number | null; advances: string | null }[]
  habitsNotDoneToday: { id: string; title: string; areaName: string | null; currentStreak: number; targetMinutes: number | null }[]
  activeGoals: {
    id: string
    title: string
    areaName: string | null
    daysUntilDeadline: number | null
    confidence: number
    confidenceLabel: "ON_TRACK" | "AT_RISK" | "OFF_TRACK"
    daysSinceProgress: number | null
  }[]
  recentActivity: { tasksCompleted7d: number; habitsLogged7d: number; focusSessions7d: number; mostActiveAreaId: string | null }
  identity: {
    purpose: string | null
    thisYearGoal: string | null
    values: string[]
    bigPicture: string | null
    lifeVision: string | null
    personality: string | null
    strengths: string[]
    weaknesses: string[]
  }
  streakAlerts: StreakAlert[]
  schedule: ScheduleInfo
  weeklyPattern: string
  pendingCaptures: number
  daysSinceReview: number | null
  stalledProjects: {
    id: string
    title: string
    areaName: string | null
    openTasks: number
    daysSinceProgress: number | null
  }[]
  continueResources: { id: string; title: string; areaName: string | null }[]
  vaultPicks: {
    id: string
    title: string
    vaultType: string
    usedCount: number
    helpfulCount: number
  }[]
  insightNotes: { id: string; title: string }[]
}

const buildContextSummary = (
  raw: RawContext,
  calendarBlocks: CalendarBlockDto[],
): ContextSummary => {
  const areaMap = new Map(raw.areas.map((a) => [a.id, a.name]))
  const tz = raw.timezone
  const now = new Date()
  const tk = dayKeyInTz(now, tz)

  // Today's schedule: which time block (if any) is happening right now, and the
  // next one coming up — so a recommendation can respect what the user has
  // actually blocked their time for.
  const fmtLocalTime = (d: Date): string =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d)

  const nowMs = now.getTime()
  const sortedBlocks = [...calendarBlocks].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  )
  const currentRaw = sortedBlocks.find(
    (b) => new Date(b.startTime).getTime() <= nowMs && nowMs < new Date(b.endTime).getTime(),
  )
  const nextRaw = sortedBlocks.find((b) => new Date(b.startTime).getTime() > nowMs)
  const schedule: ScheduleInfo = {
    current: currentRaw
      ? {
        title: currentRaw.title,
        blockType: currentRaw.blockType,
        areaName: currentRaw.areaId ? (areaMap.get(currentRaw.areaId) ?? null) : null,
        endsAt: fmtLocalTime(new Date(currentRaw.endTime)),
      }
      : null,
    next: nextRaw
      ? {
        title: nextRaw.title,
        blockType: nextRaw.blockType,
        areaName: nextRaw.areaId ? (areaMap.get(nextRaw.areaId) ?? null) : null,
        startsAt: fmtLocalTime(new Date(nextRaw.startTime)),
      }
      : null,
    todayCount: sortedBlocks.length,
  }

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
    const scored = scoreArea(a.id, scoringInput, tz, now)
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
    const stats = computeHabitStats(h.logs, 28, tz, now)
    const todayDone = h.logs.some((l) => utcDayKey(l.date) === tk && l.completed)
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

  // Which pending tasks advance an ACTIVE goal or an IN-PROGRESS resource?
  // A task carrying an ADVANCES link into current work is worth more than an
  // equally-ranked orphan to-do — annotate it so the coach can prefer it.
  // Goals win over resources when a task advances both.
  const activeGoalTitle = new Map(raw.activeGoals.map((g) => [g.id, g.title]))
  const continueResTitle = new Map(raw.continueResources.map((r) => [r.id, r.title]))
  const advanceByTask = new Map<string, string>()
  for (const link of raw.advanceLinks) {
    if (link.toType === "GOAL" && activeGoalTitle.has(link.toId)) {
      advanceByTask.set(link.fromId, `active goal: ${activeGoalTitle.get(link.toId)}`)
    }
  }
  for (const link of raw.advanceLinks) {
    if (
      link.toType === "RESOURCE" &&
      continueResTitle.has(link.toId) &&
      !advanceByTask.has(link.fromId)
    ) {
      advanceByTask.set(link.fromId, `in-progress resource: ${continueResTitle.get(link.toId)}`)
    }
  }

  // Map a raw task row to the lean shape the coach reasons over.
  const mapTask = (t: {
    id: string
    title: string
    priority: string
    dueDate: Date | null
    areaId: string | null
    targetMinutes?: number | null
  }) => {
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
      advances: advanceByTask.get(t.id) ?? null,
    }
  }

  // Overdue tasks are fetched authoritatively (any priority, no top-N cutoff) so
  // an overdue but low-priority task can't slip past the priority-sorted pending
  // window. Surface them first (most overdue first), then fill with the rest.
  const overdueMapped = raw.overdueTasks
    .map(mapTask)
    .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0))
  const overdueIds = new Set(overdueMapped.map((t) => t.id))
  const topPendingTasks = [
    ...overdueMapped,
    ...raw.pendingTasks.filter((t) => !overdueIds.has(t.id)).map(mapTask),
  ].slice(0, 10)

  // Goals with deadline proximity
  const activeGoals = raw.activeGoals.slice(0, 5).map((g) => {
    const daysUntilDeadline = g.deadline
      ? Math.floor((new Date(g.deadline).getTime() - now.getTime()) / 86_400_000)
      : null
    // Live goal confidence — the accountability number — so the coach can call
    // out an active goal that's stalling, not only one with a near deadline.
    const conf = scoreGoalConfidence({
      goalId: g.id,
      areaId: g.areaId,
      deadline: g.deadline,
      tasks: raw.goalLinkedTasks.filter((t) => t.goalId === g.id),
      habits: raw.habits
        .filter((h) => h.areaId === g.areaId)
        .map((h) => ({ logs: h.logs })),
    }, tz, now)
    return {
      id: g.id,
      title: g.title,
      areaName: g.areaId ? (areaMap.get(g.areaId) ?? null) : null,
      daysUntilDeadline,
      confidence: conf.confidence,
      confidenceLabel: conf.label,
      daysSinceProgress: conf.daysSinceProgress,
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

  // ── Projects, inbox, reviews, resources, vault, notes ──

  // Stalled active project: has open work but no recent progress, or overdue tasks.
  const stalledProjects = raw.activeProjects
    .map((p) => {
      const openTasks = p.tasks.filter(
        (t) => t.status === "TODO" || t.status === "IN_PROGRESS",
      ).length
      const completedDates = p.tasks
        .filter((t) => t.completedAt)
        .map((t) => t.completedAt as Date)
      const lastProgress = completedDates.length
        ? completedDates.reduce((a, b) => (a > b ? a : b))
        : null
      const daysSinceProgress = lastProgress
        ? Math.floor((now.getTime() - lastProgress.getTime()) / 86_400_000)
        : null
      const hasOverdue = p.tasks.some(
        (t) =>
          (t.status === "TODO" || t.status === "IN_PROGRESS") &&
          t.dueDate != null &&
          t.dueDate < now,
      )
      const stalled =
        openTasks > 0 && (hasOverdue || daysSinceProgress === null || daysSinceProgress >= 7)
      return {
        id: p.id,
        title: p.title,
        areaName: p.areaId ? (areaMap.get(p.areaId) ?? null) : null,
        openTasks,
        daysSinceProgress,
        stalled,
      }
    })
    .filter((p) => p.stalled)
    .map(({ stalled, ...p }) => p)

  const daysSinceReview = raw.lastReview?.periodEnd
    ? Math.floor((now.getTime() - new Date(raw.lastReview.periodEnd).getTime()) / 86_400_000)
    : null

  const continueResources = raw.continueResources.map((r) => ({
    id: r.id,
    title: r.title,
    areaName: r.topic?.areaId ? (areaMap.get(r.topic.areaId) ?? null) : null,
  }))

  const vaultPicks = raw.vaultItems.map((v) => ({
    id: v.id,
    title: v.title,
    vaultType: v.vaultType,
    usedCount: v.usedCount,
    helpfulCount: v.helpfulCount,
  }))

  const insightNotes = raw.insightNotes.map((n) => ({ id: n.id, title: n.title }))

  return {
    timeOfDay: timeOfDayLabel(tz, now),
    areas,
    topPendingTasks,
    habitsNotDoneToday,
    activeGoals,
    recentActivity: { tasksCompleted7d, habitsLogged7d, focusSessions7d, mostActiveAreaId },
    identity: {
      purpose: raw.identity?.purpose ?? null,
      thisYearGoal: raw.identity?.thisYearGoal ?? null,
      values: raw.identity?.values ?? [],
      bigPicture: raw.identity?.bigPicture ?? null,
      lifeVision: raw.identity?.lifeVision ?? null,
      personality: raw.identity?.personality ?? null,
      strengths: raw.identity?.strengths ?? [],
      weaknesses: raw.identity?.weaknesses ?? [],
    },
    streakAlerts: streakAlertsFixed,
    schedule,
    weeklyPattern,
    pendingCaptures: raw.pendingCaptures,
    daysSinceReview,
    stalledProjects,
    continueResources,
    vaultPicks,
    insightNotes,
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
  const idle =
    ctx.recentActivity.tasksCompleted7d === 0 && ctx.recentActivity.habitsLogged7d === 0

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

  // 2. High priority tasks — among equals, lead with one that advances an
  // active goal or in-progress resource (its "advances" note is set).
  const highTasks = ctx.topPendingTasks
    .filter((t) => (t.priority === "CRITICAL" || t.priority === "HIGH") && !t.daysOverdue)
    .sort((a, b) => Number(!!b.advances) - Number(!!a.advances))
  for (const t of highTasks.slice(0, 2)) {
    suggestions.push({
      rank: suggestions.length + 1,
      type: "TASK",
      refId: t.id,
      title: t.title,
      reason: t.advances
        ? `High priority — and it advances your ${t.advances}.`
        : "High priority task — doing this moves the needle on your goals.",
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

  // 3.5 Active goal losing momentum — surface the single worst stalling goal,
  // so the accountability number actually changes what the coach recommends.
  const atRiskGoal = [...ctx.activeGoals]
    .filter(
      (g) =>
        g.confidenceLabel === "OFF_TRACK" ||
        (g.confidenceLabel === "AT_RISK" && (g.daysSinceProgress ?? 0) >= 5),
    )
    .sort((a, b) => a.confidence - b.confidence)[0]
  if (atRiskGoal) {
    suggestions.push({
      rank: suggestions.length + 1,
      type: "GOAL",
      refId: atRiskGoal.id,
      title: `Move "${atRiskGoal.title}" forward`,
      reason:
        atRiskGoal.daysSinceProgress != null
          ? `Confidence ${atRiskGoal.confidence}/100 — ${atRiskGoal.daysSinceProgress} day(s) since real progress on this goal.`
          : `Confidence ${atRiskGoal.confidence}/100 — this goal needs attention.`,
      urgency: atRiskGoal.confidenceLabel === "OFF_TRACK" ? "HIGH" : "MEDIUM",
      actionableSteps: [
        "Do one task or habit tied to this goal today",
        "Or break it into a concrete next step",
      ],
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

  // 5. A stalling active project
  const stalledProject = ctx.stalledProjects[0]
  if (stalledProject) {
    suggestions.push({
      rank: suggestions.length + 1,
      type: "PROJECT",
      refId: stalledProject.id,
      title: `Nudge "${stalledProject.title}" forward`,
      reason:
        stalledProject.daysSinceProgress != null
          ? `${stalledProject.openTasks} open task(s), no progress in ${stalledProject.daysSinceProgress} day(s).`
          : `${stalledProject.openTasks} open task(s) and no progress logged yet.`,
      urgency: "MEDIUM",
      actionableSteps: ["Open the project", "Complete or schedule its next task"],
    })
  }

  // 6. Unsorted captures piling up in the inbox
  if (ctx.pendingCaptures >= 3) {
    suggestions.push({
      rank: suggestions.length + 1,
      type: "CAPTURE",
      refId: null,
      title: `Process your inbox (${ctx.pendingCaptures} items)`,
      reason: `${ctx.pendingCaptures} brain-dumps are waiting to be sorted into your life.`,
      urgency: "MEDIUM",
      actionableSteps: ["Open the inbox", "Convert or dismiss each item"],
    })
  }

  // 7. Reflection overdue
  if (ctx.daysSinceReview === null || ctx.daysSinceReview >= 7) {
    suggestions.push({
      rank: suggestions.length + 1,
      type: "REVIEW",
      refId: null,
      title: ctx.daysSinceReview === null ? "Do your first review" : "Time for a weekly review",
      reason:
        ctx.daysSinceReview === null
          ? "You haven't reflected yet — a review turns activity into learning."
          : `It's been ${ctx.daysSinceReview} day(s) since your last review.`,
      urgency: "LOW",
      actionableSteps: ["Open Review", "Generate a draft from your week", "Note one win and one fix"],
    })
  }

  // 8. Continue a learning resource you already started
  const resource = ctx.continueResources[0]
  if (resource) {
    suggestions.push({
      rank: suggestions.length + 1,
      type: "RESOURCE",
      refId: resource.id,
      title: `Continue: ${resource.title}`,
      reason: "You started this and haven't finished — keep the momentum.",
      urgency: "LOW",
      actionableSteps: ["Spend 15 minutes on it", "Log your progress"],
    })
  }

  // 9. Revisit a vault item — only when slipping/idle, and pick the RIGHT one:
  // prefer a MOTIVATION/RECOVERY item (the tool for this moment), and among
  // candidates favour what has actually helped before and hasn't been
  // over-surfaced (helpfulCount desc, then usedCount asc) — not just the newest.
  if (idle || atRiskGoal) {
    const slippingPicks = ctx.vaultPicks.filter(
      (v) => v.vaultType === "RECOVERY" || v.vaultType === "MOTIVATION",
    )
    const vaultPick = (slippingPicks.length ? slippingPicks : ctx.vaultPicks)
      .slice()
      .sort((a, b) => b.helpfulCount - a.helpfulCount || a.usedCount - b.usedCount)[0]
    if (vaultPick) {
      suggestions.push({
        rank: suggestions.length + 1,
        type: "VAULT",
        refId: vaultPick.id,
        title: `Revisit: ${vaultPick.title}`,
        reason:
          vaultPick.vaultType === "RECOVERY" || vaultPick.vaultType === "MOTIVATION"
            ? "A bit of motivation from your vault for exactly this moment."
            : "A moment of perspective from your vault to reset and refocus.",
        urgency: "LOW",
        actionableSteps: ["Open it", "Take a breath and re-read it"],
      })
    }
  }

  // 10. Develop a recent insight before it fades
  const insight = ctx.insightNotes[0]
  if (insight) {
    suggestions.push({
      rank: suggestions.length + 1,
      type: "NOTE",
      refId: insight.id,
      title: `Develop your insight: ${insight.title}`,
      reason: "A recent idea worth turning into action before it fades.",
      urgency: "LOW",
      actionableSteps: ["Re-read the note", "Turn it into a task or expand it"],
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

  // Anchor the narrative to the clock: what they're time-blocked into now, or
  // what's coming up next.
  if (ctx.schedule.current) {
    briefing = `You're in your ${ctx.schedule.current.title} block until ${ctx.schedule.current.endsAt}. ${briefing}`
  } else if (ctx.schedule.next) {
    briefing = `${briefing} Next on your calendar: ${ctx.schedule.next.title} at ${ctx.schedule.next.startsAt}.`
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
    schedule: ctx.schedule,
    generatedAt: new Date(),
    source: "heuristic",
  }
}

// ── Gemini prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the executive advisor AI of LifeOS, a personal operating system.
Your goal is to analyze the user's current state and recommend exactly what they should focus on next to achieve their goals, build consistent habits, and maintain balanced life areas.

You will receive a JSON snapshot of the user's current context: the time of day, today's time-blocked schedule (schedule.current = the block happening RIGHT NOW with when it ends, schedule.next = the next upcoming block with when it starts, schedule.todayCount = how many blocks today), area scores, pending tasks (each may carry an "advances" note naming an active goal or in-progress resource it moves forward when completed), incomplete daily habits, active goals (each with a live confidence 0-100, a label ON_TRACK/AT_RISK/OFF_TRACK, and days since real progress), recent behavior patterns, the user's full identity profile (purpose, this year's goal, values, big-picture direction, life vision, personality, strengths, weaknesses), stalling active projects, the count of unsorted captures in the inbox (pendingCaptures), days since the last review (daysSinceReview), in-progress learning resources, saved vault items (motivation/memory), and recent insight notes.

<rules>
1. Output raw JSON only. Do NOT format with markdown code blocks (e.g. \`\`\`json).
2. Recommendations must be highly specific, directly naming tasks or habits in the context. Avoid generic or high-level advice.
3. Be direct and honest. If the user is neglecting an area or falling behind on habits, state it clearly.
4. Urgency/Priority hierarchy:
   - Overdue tasks
   - Incomplete habits with active streaks (highest streak first)
   - High-priority tasks
   - Active goals losing momentum (OFF_TRACK/AT_RISK confidence, many days since progress)
   - A stalling active project (open tasks, no recent progress)
   - Goals with approaching deadlines
   - Neglected life areas (low scores)
   - A full inbox of unsorted captures (nudge processing it)
   - An overdue review (nudge reflecting), when little else is urgent
   - Continuing an in-progress resource, or revisiting a vault item / insight note — only when the user is otherwise idle
5. Tie-breaker: among tasks of otherwise-equal urgency, prefer one whose "advances" field is set — completing it moves an active goal or in-progress study track forward, not just an isolated to-do. When you recommend such a task, name what it advances in the "reason".
6. Include 1-3 concrete next steps for each recommendation (short, actionable phrases of max 10 words each).
7. If the user's dashboard is completely clear, recommend reviewing active goals or performing a reflection.
8. VOICE: Write "headline" and "briefing" like a sharp, warm human coach talking directly to the user — second person ("you"), specific, never corporate or generic. The headline is a punchy one-liner (max ~12 words). The briefing is 2-3 sentences that tie their state together and point at the one thing that matters most. Reference the time of day where natural. Where it fits naturally, let their personality/strengths/weaknesses shape the framing (e.g. lean on a stated strength to make a task feel achievable, or name-check a stated weakness when it's actively the reason something's stalling) and tie the recommendation back to their bigPicture/lifeVision when the moment calls for it — don't force a reference to identity fields into every response, only when it makes the advice sharper. If identity fields are null/empty, don't mention their absence.
9. "primaryAction" is the single most important thing to do RIGHT NOW. It must correspond to suggestions[0]. Set "estimatedMinutes" to a realistic effort estimate (habits ~5-15, tasks ~25-45) or null if unknowable.
10. "tone" must match reality: "celebratory" when caught up / on a hot streak, "firm" when overdue or slipping, "encouraging" when restarting momentum, "neutral" otherwise.
11. RESPECT THE CLOCK. If schedule.current is set, the user is in that time block RIGHT NOW — bias the primaryAction toward the block's activity/area and something that realistically fits before it ends (endsAt), and reference the block naturally in the briefing. If a linked habit/task belongs to the current block's area, prefer it. If schedule.next starts soon, don't tell them to start something that won't fit first — a quick habit or a small task is better. When nothing is scheduled, ignore this.
</rules>

<output_schema>
{
  "headline": "string", // Punchy human one-liner for the top of the screen, max ~12 words
  "briefing": "string", // 2-3 sentence coach-style narrative tying their state together
  "tone": "encouraging" | "firm" | "celebratory" | "neutral",
  "primaryAction": {
    "type": "TASK" | "HABIT" | "AREA_FOCUS" | "REVIEW" | "GOAL" | "PROJECT" | "CAPTURE" | "RESOURCE" | "VAULT" | "NOTE",
    "refId": "string" | null, // ID of the referenced entity; must match suggestions[0].refId
    "title": "string", // The one thing to do now
    "why": "string", // One human sentence: why THIS, right now
    "estimatedMinutes": number | null
  } | null, // null only when there is genuinely nothing to do
  "suggestions": [
    {
      "rank": number, // 1 to 5 sequential recommendation rank
      "type": "TASK" | "HABIT" | "AREA_FOCUS" | "REVIEW" | "GOAL" | "PROJECT" | "CAPTURE" | "RESOURCE" | "VAULT" | "NOTE",
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
    schedule: ctx.schedule,
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

export const getDecisions = async (
  raw: RawContext,
  calendarBlocks: CalendarBlockDto[] = [],
): Promise<DecisionResult> => {
  const ctx = buildContextSummary(raw, calendarBlocks)

  return runWithAiFallback(
    "Decisions generator",
    {
      gemini: geminiClient ? () => geminiGetDecisions(ctx) : undefined,
      groq: groqClient ? () => groqGetDecisions(ctx) : undefined,
    },
    () => ({ ...heuristicDecision(ctx), source: "heuristic" as const }),
  )
}
