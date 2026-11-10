/* =====================================================================
   Shrink the pile: the honest sum of everything on the list, and holds
   ("not until this date"). Pure code, no AI: the person decides, and these
   numbers only have to be plain and repeatable.
   ===================================================================== */
import { daysBetweenKeys, dateFromKey } from "../../shared/utils/time.util.js"

export const PILE_MAX = 30

const DEFAULT_HABIT_MINUTES = 15
const DEFAULT_TASK_MINUTES = 30
const DEFAULT_SESSION_MINUTES = 25
const WORK_PROJECT_MINUTES = 60

// ---- holds ---------------------------------------------------------------------------
// A hold is an activity event whose reason is "until:YYYY-MM-DD". Using the log means
// no new column, and Undo ends a hold by itself because undone events are ignored.

export const holdReason = (key: string) => `until:${key}`

const returnedSuffix = ":returned"
export const returnedReason = (reason: string) => `${reason}${returnedSuffix}`

export const holdUntil = (reason: string | null | undefined): string | null => {
  const m = reason?.match(/^until:(\d{4}-\d{2}-\d{2})$/)
  return m ? m[1]! : null
}

export interface HoldEvent {
  itemId: string | null
  reason: string | null
}

const latestPerItem = <T extends HoldEvent>(newestFirst: T[]): T[] => {
  const seen = new Set<string>()
  return newestFirst.filter((e) => {
    if (!e.itemId || seen.has(e.itemId)) return false
    seen.add(e.itemId)
    return true
  })
}

// Items that should stay out of the way today. Only an item's latest hold counts.
export const activeHoldIds = (newestFirst: HoldEvent[], todayKey: string): Set<string> =>
  new Set(
    latestPerItem(newestFirst)
      .filter((e) => {
        const until = holdUntil(e.reason)
        return until !== null && until > todayKey
      })
      .map((e) => e.itemId!),
  )

// Parked things whose date has come: they go back on the list.
export const holdsEnded = <T extends HoldEvent>(newestFirst: T[], todayKey: string): T[] =>
  latestPerItem(newestFirst).filter((e) => {
    const until = holdUntil(e.reason)
    return until !== null && until <= todayKey
  })

// The first of a month at least 30 days away: far enough to stop thinking about it.
export const parkUntilKey = (todayKey: string): string => {
  const d = dateFromKey(todayKey)
  let year = d.getUTCFullYear()
  let month = d.getUTCMonth()
  for (;;) {
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
    const key = `${year}-${String(month + 1).padStart(2, "0")}-01`
    if (daysBetweenKeys(todayKey, key) >= 30) return key
  }
}

export const monthName = (key: string): string =>
  new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(dateFromKey(key))

// The event title is the receipt ("Learn guitar is parked until January."): the list wants the name.
export const parkedName = (title: string | null): string => (title ?? "").replace(/ is parked until .*$/, "")

export interface ParkedEvent extends HoldEvent {
  id: string
  itemType: string
  title: string | null
}

// What is parked today, newest first. Undoing the event is what brings it back.
export const parkedRows = (newestFirst: ParkedEvent[], todayKey: string) =>
  latestPerItem(newestFirst)
    .filter((e) => {
      const until = holdUntil(e.reason)
      return until !== null && until > todayKey
    })
    .map((e) => {
      const until = holdUntil(e.reason)!
      return { activityId: e.id, itemType: e.itemType, title: parkedName(e.title), until, untilLabel: monthName(until) }
    })

// The area left alone longest, if any has been quiet for two weeks. Areas set aside on purpose don't count.
export const quietestArea = (areas: { name: string; idleDays: number; tier: string }[]): string | null => {
  const quiet = areas.filter((a) => a.idleDays >= 14 && a.tier !== "LATER").sort((a, b) => b.idleDays - a.idleDays)
  return quiet[0]?.name ?? null
}

// ---- what each thing costs in a week -------------------------------------------------

export const habitWeeklyMinutes = (h: {
  frequency: string
  weeklyTarget: number | null
  specificDays: string[]
  targetMinutes: number | null
}): number => {
  const times =
    h.frequency === "WEEKLY" ? Math.max(1, h.weeklyTarget ?? 1)
    : h.frequency === "CUSTOM" ? Math.max(1, h.specificDays.length)
    : 7
  return times * (h.targetMinutes && h.targetMinutes > 0 ? h.targetMinutes : DEFAULT_HABIT_MINUTES)
}

export const taskMinutes = (t: { sizeMinutes: number | null; targetMinutes: number | null }): number =>
  t.sizeMinutes ?? t.targetMinutes ?? DEFAULT_TASK_MINUTES

export const projectWeeklyMinutes = (p: {
  weeklyTargetMinutes: number | null
  weeklyTargetCount: number | null
  sessionMinutes: number | null
  openTaskMinutes: number
}): number => {
  if (p.weeklyTargetMinutes && p.weeklyTargetMinutes > 0) return p.weeklyTargetMinutes
  if (p.weeklyTargetCount && p.weeklyTargetCount > 0) return p.weeklyTargetCount * (p.sessionMinutes ?? DEFAULT_SESSION_MINUTES)
  return p.openTaskMinutes > 0 ? p.openTaskMinutes : WORK_PROJECT_MINUTES
}

// ---- the plain words on each card ----------------------------------------------------

export const durationText = (minutes: number): string => {
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.round(minutes / 30) / 2
  return hours === 1 ? "1 hour" : `${hours} hours`
}

export type PileType = "TASK" | "HABIT" | "PROJECT"

export const needsLine = (type: PileType, minutes: number): string =>
  type === "TASK" ? `Needs about ${durationText(minutes)}.` : `Needs about ${durationText(minutes)} a week.`

export const ageLine = (days: number): string | null => {
  if (days < 14) return null
  if (days < 60) return `On your list for ${Math.round(days / 7)} weeks`
  const months = Math.round(days / 30)
  return `On your list for ${months} months`
}

export const dueLine = (dueKey: string | null, todayKey: string): string | null => {
  if (!dueKey) return null
  const days = daysBetweenKeys(todayKey, dueKey)
  if (days < 0) return "The date for this has passed"
  if (days === 0) return "Due today"
  if (days === 1) return "Due tomorrow"
  return days <= 7 ? `Due in ${days} days` : null
}

export interface PileItem {
  sourceType: PileType
  sourceId: string
  title: string
  weeklyMinutes: number
  ageDays: number
  ageLine: string | null
  dueLine: string | null
  needs: string
}

const TYPE_ORDER: Record<PileType, number> = { PROJECT: 0, HABIT: 1, TASK: 2 }

// Big commitments first: a decision about a goal removes more than one about a to-do.
export const rankPile = (items: PileItem[]): PileItem[] =>
  [...items].sort(
    (a, b) => TYPE_ORDER[a.sourceType] - TYPE_ORDER[b.sourceType] || b.weeklyMinutes - a.weeklyMinutes || b.ageDays - a.ageDays,
  )
