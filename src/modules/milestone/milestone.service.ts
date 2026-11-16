// Milestones (5.0 #44): draft, keep, reach, let go. Each change can be undone.
// The words and the order of things come from milestone.rules.ts.

import type { ActivitySource } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { ConflictError, NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { firstStepFor } from "../goalplan/goalplan.rules.js"
import {
  cleanMilestones, fallbackMilestones, goalProgress, letGoPlan, MAX_MILESTONES, MILESTONE_KIND, MIN_MILESTONES, reachPlan,
  type GoalProgress, type MilestoneRow,
} from "./milestone.rules.js"

const OPEN = ["TODO", "IN_PROGRESS"] as const

// Each milestone with its step counts, grouped by the big goal.
export const milestoneRows = async (userId: string, parentIds: string[]): Promise<Map<string, MilestoneRow[]>> => {
  const out = new Map<string, MilestoneRow[]>()
  if (!parentIds.length) return out
  const goals = await prisma.goal.findMany({
    where: { userId, parentId: { in: parentIds } },
    select: { id: true, parentId: true, title: true, order: true, status: true, tasks: { select: { status: true, archivedAt: true } } },
  })
  for (const g of goals) {
    const list = out.get(g.parentId!) ?? []
    list.push({
      id: g.id,
      title: g.title,
      order: g.order ?? 0,
      status: g.status,
      // Done steps keep counting even if let go later; open ones only while kept.
      stepsDone: g.tasks.filter((t) => t.status === "COMPLETED").length,
      stepsOpen: g.tasks.filter((t) => (OPEN as readonly string[]).includes(t.status) && !t.archivedAt).length,
    })
    out.set(g.parentId!, list)
  }
  return out
}

export const progressOf = async (userId: string, parentIds: string[]): Promise<Map<string, GoalProgress>> => {
  const rows = await milestoneRows(userId, parentIds)
  const out = new Map<string, GoalProgress>()
  for (const [id, list] of rows) {
    const p = goalProgress(list)
    if (p) out.set(id, p)
  }
  return out
}

const ownedBigGoal = async (userId: string, goalId: string) => {
  const g = await prisma.goal.findFirst({ where: { id: goalId, userId, parentId: null }, select: { id: true, title: true, why: true, areaId: true, deadline: true } })
  if (!g) throw new NotFoundError("Goal not found")
  return g
}

const ownedMilestone = async (userId: string, id: string) => {
  const m = await prisma.goal.findFirst({ where: { id, userId, parentId: { not: null } }, select: { id: true, title: true, parentId: true, areaId: true, status: true } })
  if (!m) throw new NotFoundError("Milestone not found")
  return m
}

const PROMPT = (goal: string, why: string | null, deadline: string | null) => `Split this goal into milestones: small goals, each reachable in 1 to 4 weeks, in order.
Goal: "${goal}"${why ? `\nWhy it matters to them: "${why}"` : ""}${deadline ? `\nBy: ${deadline}` : ""}
Return JSON only: {"milestones": [string]}
Rules:
- ${MIN_MILESTONES} to ${MAX_MILESTONES} milestones. Each is a result they can see is reached ("Run 5 km without stopping"), not an activity ("Practise running").
- Short, plain, in their words where possible. No numbering, no dates.
- The last one is the goal itself, reached.
- Never invent facts about them.`

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    return m ? JSON.parse(m[0]) : null
  }
}

// AI drafts the wording; code keeps it to 3–6 clean titles; without AI, three plain ones.
export const draftMilestones = async (goal: string, why: string | null, deadline: string | null, done?: string | null): Promise<{ milestones: string[]; draftedBy: "AI" | "CODE" }> => {
  const prompt = PROMPT(goal, why, deadline)
  const raw = await runWithAiFallback<unknown | null>(
    "Milestones",
    {
      gemini: geminiClient
        ? async () => {
            const model = geminiClient!.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json" } })
            return parse((await model.generateContent(prompt)).response.text())
          }
        : undefined,
      groq: groqClient
        ? async () => {
            const r = await groqClient!.chat.completions.create({
              model: "openai/gpt-oss-120b",
              response_format: { type: "json_object" },
              messages: [{ role: "user", content: prompt }],
            })
            return parse(r.choices[0]?.message?.content || "{}")
          }
        : undefined,
    },
    () => null,
  ).catch(() => null)
  const cleaned = cleanMilestones((raw as Record<string, unknown> | null)?.milestones)
  if (cleaned.length >= MIN_MILESTONES) return { milestones: cleaned, draftedBy: "AI" }
  return { milestones: fallbackMilestones(goal, done), draftedBy: "CODE" }
}

// POST /milestones/propose: a draft for an existing goal. Nothing saved.
export const proposeMilestonesService = async (userId: string, goalId: string) => {
  const g = await ownedBigGoal(userId, goalId)
  return draftMilestones(g.title, g.why, g.deadline ? g.deadline.toISOString().slice(0, 10) : null)
}

// Keeps milestones under a goal: the first opens, the rest wait. The goal's
// open steps move under the first one. One Undo takes all of it back.
export const createMilestones = async (userId: string, goal: { id: string; areaId: string }, titles: string[], moveOpenSteps: boolean) => {
  const ids: string[] = []
  for (const [order, title] of titles.entries()) {
    const m = await prisma.goal.create({
      data: { userId, areaId: goal.areaId, parentId: goal.id, order, title, kind: MILESTONE_KIND, status: order === 0 ? "ACTIVE" : "PAUSED", activatedAt: order === 0 ? new Date() : null },
    })
    ids.push(m.id)
  }
  const moved = moveOpenSteps
    ? await prisma.task.findMany({ where: { userId, goalId: goal.id, archivedAt: null, status: { in: [...OPEN] } }, select: { id: true } })
    : []
  if (moved.length) await prisma.task.updateMany({ where: { id: { in: moved.map((t) => t.id) }, userId }, data: { goalId: ids[0] } })
  const undo: UndoPayload[] = [
    ...moved.map((t) => ({ kind: "RESTORE_FIELDS" as const, model: "task" as const, id: t.id, prev: { goalId: goal.id } })),
    ...ids.map((id) => ({ kind: "RESTORE_FIELDS" as const, model: "goal" as const, id, prev: { status: "ABANDONED" } })),
  ]
  return { ids, undo }
}

export const setMilestonesService = async (userId: string, goalId: string, input: unknown, source: ActivitySource = "APP") => {
  const g = await ownedBigGoal(userId, goalId)
  const titles = cleanMilestones(input)
  if (titles.length < 2) throw new ValidationError("Give at least two milestones.")
  const live = await prisma.goal.count({ where: { userId, parentId: g.id, status: { not: "ABANDONED" } } })
  if (live) throw new ConflictError("This goal already has milestones.")
  const { ids, undo } = await createMilestones(userId, g, titles, true)
  const ev = await recordActivity(userId, {
    type: "CREATED", itemType: "MILESTONE", itemId: g.id, title: `${g.title}: ${titles.length} milestones`, source, undo: { kind: "MANY", items: undo },
  })
  return { ids, progress: (await progressOf(userId, [g.id])).get(g.id) ?? null, activityId: ev?.id }
}

// POST /milestones/add: one more milestone at the end.
export const addMilestoneService = async (userId: string, goalId: string, title: string, source: ActivitySource = "APP") => {
  const g = await ownedBigGoal(userId, goalId)
  const [t] = cleanMilestones([title])
  if (!t) throw new ValidationError("Give the milestone a name.")
  const rows = (await milestoneRows(userId, [g.id])).get(g.id) ?? []
  const kept = rows.filter((r) => r.status !== "ABANDONED")
  if (kept.length >= MAX_MILESTONES + 2) throw new ValidationError("That is a lot of milestones. Let one go first.")
  // If every milestone so far is reached (or there are none), the new one is current.
  const current = !kept.some((r) => r.status === "ACTIVE" || r.status === "PAUSED")
  const order = rows.reduce((m, r) => Math.max(m, r.order + 1), 0)
  const m = await prisma.goal.create({
    data: { userId, areaId: g.areaId, parentId: g.id, order, title: t, kind: MILESTONE_KIND, status: current ? "ACTIVE" : "PAUSED", activatedAt: current ? new Date() : null },
  })
  const ev = await recordActivity(userId, {
    type: "CREATED", itemType: "MILESTONE", itemId: m.id, title: t, source, undo: { kind: "RESTORE_FIELDS", model: "goal", id: m.id, prev: { status: "ABANDONED" } },
  })
  return { id: m.id, activityId: ev?.id }
}

const rowsFor = async (userId: string, parentId: string) => (await milestoneRows(userId, [parentId])).get(parentId) ?? []

// POST /milestones/:id/reached: the current one is reached and the next opens.
// If the next has no steps yet, a first one is written so there is always
// something to start. One Undo puts both back and lets that step go.
export const reachMilestoneService = async (userId: string, id: string, source: ActivitySource = "APP") => {
  const m = await ownedMilestone(userId, id)
  const rows = await rowsFor(userId, m.parentId!)
  const plan = reachPlan(rows, id)
  if (!plan) throw new ValidationError("Only the current milestone can be marked reached.")
  const prevStatus = rows.find((r) => r.id === id)!.status
  await prisma.goal.update({ where: { id }, data: { status: "COMPLETED" } })
  const undo: UndoPayload[] = [{ kind: "RESTORE_FIELDS", model: "goal", id, prev: { status: prevStatus } }]
  let next: { id: string; title: string } | null = null
  let firstStep: { id: string; title: string; minutes: number } | null = null
  if (plan.open) {
    const n = rows.find((r) => r.id === plan.open)!
    await prisma.goal.update({ where: { id: n.id }, data: { status: "ACTIVE", activatedAt: new Date() } })
    undo.push({ kind: "RESTORE_FIELDS", model: "goal", id: n.id, prev: { status: n.status } })
    next = { id: n.id, title: n.title }
    if (n.stepsOpen === 0) {
      const s = firstStepFor(n.title)
      const t = await prisma.task.create({ data: { userId, areaId: m.areaId, goalId: n.id, title: s.title, sizeMinutes: s.minutes } })
      undo.push({ kind: "ARCHIVE_TASK", taskId: t.id })
      firstStep = { id: t.id, title: t.title, minutes: s.minutes }
    }
  }
  const ev = await recordActivity(userId, { type: "DONE", itemType: "MILESTONE", itemId: id, title: m.title, source, undo: { kind: "MANY", items: undo } })
  const progress = goalProgress(await rowsFor(userId, m.parentId!))
  return {
    reached: { id, title: m.title },
    next,
    firstStep,
    progress,
    message: next ? `${m.title}: reached. Next: ${next.title}.` : `${m.title}: reached. That was the last one.`,
    activityId: ev?.id,
  }
}

// POST /milestones/:id/let-go: kept, not deleted; its open steps go with it.
export const letGoMilestoneService = async (userId: string, id: string, source: ActivitySource = "APP") => {
  const m = await ownedMilestone(userId, id)
  const rows = await rowsFor(userId, m.parentId!)
  const plan = letGoPlan(rows, id)
  if (!plan) throw new ValidationError("A reached milestone stays reached.")
  const prevStatus = rows.find((r) => r.id === id)!.status
  const steps = await prisma.task.findMany({ where: { userId, goalId: id, archivedAt: null, status: { in: [...OPEN] } }, select: { id: true } })
  const now = new Date()
  await prisma.goal.update({ where: { id }, data: { status: "ABANDONED" } })
  if (steps.length) await prisma.task.updateMany({ where: { id: { in: steps.map((s) => s.id) }, userId }, data: { archivedAt: now } })
  const undo: UndoPayload[] = [
    { kind: "RESTORE_FIELDS", model: "goal", id, prev: { status: prevStatus } },
    ...steps.map((s) => ({ kind: "RESTORE_FIELDS" as const, model: "task" as const, id: s.id, prev: { archivedAt: null } })),
  ]
  if (plan.open) {
    const n = rows.find((r) => r.id === plan.open)!
    await prisma.goal.update({ where: { id: n.id }, data: { status: "ACTIVE", activatedAt: now } })
    undo.push({ kind: "RESTORE_FIELDS", model: "goal", id: n.id, prev: { status: n.status } })
  }
  const ev = await recordActivity(userId, { type: "ARCHIVED", itemType: "MILESTONE", itemId: id, title: m.title, source, undo: { kind: "MANY", items: undo } })
  return { message: `${m.title}: let go.`, progress: goalProgress(await rowsFor(userId, m.parentId!)), activityId: ev?.id }
}
