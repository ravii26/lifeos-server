/* =====================================================================
   Guards on what the model proposes (ADR 0013): code has the last word on
   the shape of things, so a long prompt can never turn one errand into a
   project.
   ===================================================================== */

export interface ProposedProject {
  type?: string
  kind?: string
  title?: string
  priority?: string
  deadline?: string | null
  areaId?: string | null
  tasks?: { title?: string; due?: string | null; priority?: string | null }[]
  milestones?: unknown
  metric?: unknown
  weeklyTargetMinutes?: unknown
}

export interface ProposedTask {
  type: "ADD_TASK"
  title: string
  due: string | null
  priority: string | undefined
  areaId: string | null
}

// A "project" with at most one to-do, no stages, no number to move and no
// weekly target is just a to-do, unless the person said the word "project".
export const projectAsTask = (a: ProposedProject, userText: string): ProposedTask | null => {
  if (a.type !== "ADD_PROJECT") return null
  if (a.kind && String(a.kind).toUpperCase() !== "WORK") return null
  if (/\bproject\b/i.test(userText)) return null
  const tasks = (a.tasks ?? []).filter((t) => t?.title?.trim())
  if (tasks.length > 1) return null
  if (Array.isArray(a.milestones) && a.milestones.length) return null
  if (a.metric || a.weeklyTargetMinutes) return null
  const title = (tasks[0]?.title ?? a.title ?? "").trim()
  if (!title) return null
  return { type: "ADD_TASK", title, due: tasks[0]?.due ?? a.deadline ?? null, priority: tasks[0]?.priority ?? a.priority ?? undefined, areaId: a.areaId ?? null }
}
