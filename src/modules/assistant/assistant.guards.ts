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

// ---- never claim what didn't happen ---------------------------------------------------
// The model sometimes answers "Skipped for today." or "Moving your extra tasks to later" when it
// emitted no action at all. If a reply says something was done and nothing was, say so instead.

const CLAIM = /^(?:(?:ok(?:ay)?|sure|got it|alright|all right)[.,!]?\s+)?(?:done|skipped|marked|moved|moving|logged|removed|deleted|added|updated|saved|turned|paused|resumed|renamed|changed|cancel(?:l)?ed|completed|all set)\b/i
const CLAIM_I = /\bI(?:'ve|\s+have)\s+(?:just\s+)?(?:marked|moved|skipped|removed|deleted|added|logged|saved|turned|paused|resumed|renamed|changed|cancel(?:l)?ed|completed)\b/i

export const NOTHING_CHANGED = "I didn't change anything. I can't do that from chat yet, or I couldn't find what you meant. Say it another way, or use the app."

export const unbackedClaim = (reply: string, actionCount: number): boolean => actionCount === 0 && (CLAIM.test(reply.trim()) || CLAIM_I.test(reply))

// "Memory settings updated." / "Your list has been updated." with no action behind it.
const CLAIM_STATE = /\b(?:settings?|memory|memories|list|plan|reminders?|habits?)\s+(?:has been\s+|have been\s+|is\s+now\s+)?updated\b|\bhas been (?:updated|changed|moved|removed|marked|added|saved)\b/i
export const unbackedStateClaim = (reply: string, actionCount: number): boolean => actionCount === 0 && CLAIM_STATE.test(reply)
