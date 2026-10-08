/* =====================================================================
   The Plan screen's shape (plan §5): today by part of the day, then the
   week, then everything else out of sight. Pure grouping, no DB. Overdue
   things are carried into "this week", never shown as a pile of red.
   ===================================================================== */
import { BLOCKS, type Block } from "./now.rules.js"

export type PlanBlock = Block | "ANYTIME"
export const BLOCK_ORDER: PlanBlock[] = [...BLOCKS, "ANYTIME"]

export interface PlanItem {
  id: string
  type: "TASK" | "HABIT" | "REMINDER"
  title: string
  block: PlanBlock
  minutes: number | null
  done: boolean
  at: string | null // reminder time, ISO
  dueKey: string | null
  stage?: string // habits: NEW | BUILDING | AUTOMATIC
  minimum?: string | null
  projectTitle?: string | null
  priorityRank?: number // 0 = highest
}

export interface BlockGroup {
  block: PlanBlock
  items: PlanItem[]
}

// Within a block: timed reminders first (by time), then what is still to do,
// then what is already done (kept visible: progress only accumulates).
const order = (a: PlanItem, b: PlanItem): number => {
  if (a.done !== b.done) return a.done ? 1 : -1
  if (a.at && b.at) return a.at.localeCompare(b.at)
  if (a.at) return -1
  if (b.at) return 1
  return (a.priorityRank ?? 2) - (b.priorityRank ?? 2) || a.title.localeCompare(b.title)
}

export const groupByBlock = (items: PlanItem[]): BlockGroup[] =>
  BLOCK_ORDER.map((block) => ({ block, items: items.filter((i) => i.block === block).sort(order) })).filter((g) => g.items.length > 0)

export type Bucket = "TODAY" | "WEEK" | "CARRIED" | "LATER"

const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// Where an open to-do belongs on the Plan: no date or beyond the week is
// "later" (out of sight), a past date is quietly carried into this week.
export const bucketFor = (dueKey: string | null, todayKey: string): Bucket => {
  if (!dueKey) return "LATER"
  if (dueKey === todayKey) return "TODAY"
  if (dueKey < todayKey) return "CARRIED"
  return dueKey <= addDays(todayKey, 6) ? "WEEK" : "LATER"
}

export interface DayGroup {
  date: string
  items: PlanItem[]
}

export const groupByDay = (items: PlanItem[]): DayGroup[] =>
  [...new Set(items.map((i) => i.dueKey ?? ""))]
    .filter(Boolean)
    .sort()
    .map((date) => ({ date, items: items.filter((i) => i.dueKey === date).sort(order) }))
