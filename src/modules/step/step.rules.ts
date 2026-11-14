// Steps are tasks seen from a plan: something to do, sized in minutes, with
// the energy it takes. These rules decide where "move it" lands and what an
// edit changes. Pure code.

import { nextSaturdayKey } from "../now/brain.rules.js"

export const MOVES = ["TOMORROW", "WEEKEND", "NEXT_WEEK"] as const
export type Move = (typeof MOVES)[number]

const addDays = (key: string, n: number): string => {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// The Monday after this week (from a Monday, the next one).
export const nextMondayKey = (todayKey: string): string => {
  const wd = new Date(`${todayKey}T00:00:00Z`).getUTCDay()
  return addDays(todayKey, ((1 - wd + 7) % 7) || 7)
}

// The day a moved step comes back. It is not suggested before then.
export const moveTargetKey = (move: Move, todayKey: string): string =>
  move === "TOMORROW" ? addDays(todayKey, 1) : move === "WEEKEND" ? nextSaturdayKey(todayKey) : nextMondayKey(todayKey)

export const moveWords = (move: Move): string => (move === "TOMORROW" ? "tomorrow" : move === "WEEKEND" ? "Saturday" : "next Monday")

export interface StepEdit {
  title?: string
  sizeMinutes?: number | null
  energy?: "LOW" | "NORMAL" | "HIGH" | null
  minimumVersion?: string | null
}

// Only the fields that actually change, each with its value before: the
// update to make and what Undo puts back.
export const diffEdit = (
  current: { title: string; sizeMinutes: number | null; energy: string | null; minimumVersion: string | null },
  edit: StepEdit,
): { data: Record<string, unknown>; prev: Record<string, unknown> } => {
  const data: Record<string, unknown> = {}
  const prev: Record<string, unknown> = {}
  const norm = (v: unknown) => (typeof v === "string" ? v.trim() || null : v)
  for (const key of ["title", "sizeMinutes", "energy", "minimumVersion"] as const) {
    if (edit[key] === undefined) continue
    const next = norm(edit[key])
    // A step always has a name.
    if (key === "title" && !next) continue
    if (next === current[key]) continue
    data[key] = next
    prev[key] = current[key]
  }
  return { data, prev }
}
