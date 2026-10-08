/* =====================================================================
   "Where do I stand?": pure progress rules (plan G1, G3). Nothing here is
   stored; every number is computed from milestones, metric entries and the
   activity log, so it can never drift. No DB, no AI, no guilt wording.
   ===================================================================== */

const DAY = 86_400_000
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

// "mid-March", "late October": enough precision for a forecast, never false precision.
export const monthPhrase = (d: Date): string => {
  const day = d.getUTCDate()
  const part = day <= 10 ? "early" : day <= 20 ? "mid" : "late"
  return `${part}-${MONTHS[d.getUTCMonth()]}`
}

// ---- milestone projects (the job switch) ---------------------------

export interface MilestoneIn {
  title: string
  order: number
  target: number | null // "50 DSA problems"
  doneAt: Date | null
  progress: number // units logged toward the target
}

export type Pace = "AHEAD" | "ON_PACE" | "BEHIND" | "NO_DEADLINE" | "NOT_STARTED"

export interface MilestoneStand {
  total: number
  doneCount: number
  stage: number // 1-based stage you are in
  percent: number
  current: { title: string; target: number | null; progress: number; remaining: number | null; unit: string } | null
  pace: Pace
  forecast: Date | null
  message: string
}

const unitOf = (title: string) => title.replace(/^\d+\s*/, "").trim() || title

export const isDone = (m: MilestoneIn) => m.doneAt !== null || (m.target !== null && m.progress >= m.target)

export const milestoneStand = (
  milestones: MilestoneIn[],
  ctx: { now: Date; createdAt: Date; deadline: Date | null },
): MilestoneStand => {
  const ms = [...milestones].sort((a, b) => a.order - b.order)
  const total = ms.length
  const doneCount = ms.filter(isDone).length
  const cur = ms.find((m) => !isDone(m)) ?? null
  const curFraction = cur?.target ? Math.min(cur.progress / cur.target, 1) : 0
  const percent = total ? Math.round(((doneCount + curFraction) / total) * 100) : 0
  const stage = Math.min(doneCount + 1, Math.max(total, 1))
  const current = cur
    ? {
        title: cur.title,
        target: cur.target,
        progress: cur.progress,
        remaining: cur.target ? Math.max(cur.target - cur.progress, 0) : null,
        unit: unitOf(cur.title),
      }
    : null

  // Pace: where you are against where the time says you should be.
  const elapsed = Math.max((ctx.now.getTime() - ctx.createdAt.getTime()) / DAY, 7)
  const fraction = percent / 100
  let forecast: Date | null = null
  if (fraction > 0 && fraction < 1) forecast = new Date(ctx.now.getTime() + ((1 - fraction) / (fraction / elapsed)) * DAY)
  let pace: Pace = fraction === 0 ? "NOT_STARTED" : "NO_DEADLINE"
  if (ctx.deadline && fraction > 0) {
    const planned = Math.max((ctx.deadline.getTime() - ctx.createdAt.getTime()) / DAY, 1)
    const expected = Math.min(elapsed / planned, 1)
    pace = fraction >= expected * 1.1 ? "AHEAD" : fraction >= expected * 0.85 ? "ON_PACE" : "BEHIND"
  }

  const parts = [`Stage ${stage} of ${total}`, `${percent}%`]
  if (current?.remaining) parts.push(`next: ${current.remaining} more ${current.unit}`)
  else if (current) parts.push(`next: ${current.title}`)
  if (!current) parts.push("every stage done")
  if (forecast && ctx.deadline && (pace === "ON_PACE" || pace === "AHEAD")) parts.push(`on pace for ${monthPhrase(ctx.deadline)}`)
  else if (forecast) parts.push(`at this pace: ${monthPhrase(forecast)}`)
  return { total, doneCount, stage, percent, current, pace, forecast, message: parts.join(" · ") }
}

// ---- outcome projects (weight 85 → 70) -------------------------------

export interface MetricIn {
  name: string
  unit: string
  startValue: number
  targetValue: number
}

export interface MetricEntryIn {
  value: number
  at: Date
}

export interface MetricStand {
  start: number
  latest: number
  target: number
  percent: number
  weeklyChange: number | null
  trend: "TOWARD" | "STALLED" | "AWAY" | "TOO_EARLY"
  forecast: Date | null
  options: string[]
  message: string
}

const regressionPerWeek = (points: { t: number; v: number }[]): number | null => {
  if (points.length < 2) return null
  const n = points.length
  const mt = points.reduce((s, p) => s + p.t, 0) / n
  const mv = points.reduce((s, p) => s + p.v, 0) / n
  const den = points.reduce((s, p) => s + (p.t - mt) ** 2, 0)
  if (den === 0) return null
  return (points.reduce((s, p) => s + (p.t - mt) * (p.v - mv), 0) / den) * 7
}

const fmtNum = (n: number) => String(Math.round(n * 10) / 10)

export const metricStand = (metric: MetricIn, entries: MetricEntryIn[], now: Date): MetricStand => {
  const sorted = [...entries].sort((a, b) => a.at.getTime() - b.at.getTime())
  const latest = sorted.length ? sorted[sorted.length - 1]!.value : metric.startValue
  const span = metric.targetValue - metric.startValue
  const percent = span === 0 ? 100 : Math.round(Math.max(0, Math.min(1, (latest - metric.startValue) / span)) * 100)
  const dir = Math.sign(span) || 1

  const recent = sorted.filter((e) => now.getTime() - e.at.getTime() <= 56 * DAY)
  const first = recent[0]
  const lastEntry = recent[recent.length - 1]
  const spanDays = first && lastEntry ? (lastEntry.at.getTime() - first.at.getTime()) / DAY : 0
  const slope = recent.length >= 2 && spanDays >= 6
    ? regressionPerWeek(recent.map((e) => ({ t: (e.at.getTime() - first!.at.getTime()) / DAY, v: e.value })))
    : null

  const unit = metric.unit ? ` ${metric.unit}` : ""
  const head = `${metric.name}: ${fmtNum(metric.startValue)} → ${fmtNum(latest)} → ${fmtNum(metric.targetValue)}${unit} · ${percent}%`
  const base = { start: metric.startValue, latest, target: metric.targetValue, percent, weeklyChange: slope === null ? null : Math.round(slope * 100) / 100 }

  if (slope === null || recent.length < 3) {
    return { ...base, trend: "TOO_EARLY", forecast: null, options: [], message: `${head} · log a couple more weeks and I'll show the trend.` }
  }
  const toward = slope * dir
  const flat = Math.abs(slope) < Math.abs(span) * 0.0035 // under ~0.35% of the journey a week
  if (flat || toward <= 0) {
    const weeks = Math.max(1, Math.round(spanDays / 7))
    return {
      ...base,
      trend: toward < 0 && !flat ? "AWAY" : "STALLED",
      forecast: null,
      options: ["Add a small habit that supports it", "Move the target date"],
      message: `${head} · it has held near ${fmtNum(latest)}${unit} for about ${weeks} week${weeks === 1 ? "" : "s"}. That happens. Two options: add a small habit that supports it, or move the target date. Your call.`,
    }
  }
  const weeksLeft = (metric.targetValue - latest) * dir / toward
  const forecast = weeksLeft > 0 && weeksLeft < 156 ? new Date(now.getTime() + weeksLeft * 7 * DAY) : null
  return {
    ...base,
    trend: "TOWARD",
    forecast,
    options: [],
    message: `${head} · ${fmtNum(Math.abs(slope))}${unit} a week${forecast ? ` · at this pace: ${monthPhrase(forecast)}` : ""}`,
  }
}

// ---- practice projects (English minutes a week) ----------------------

export interface PracticeStand {
  thisWeek: number
  target: number
  weeksOnTarget: number // of the previous full weeks (up to 8)
  weeksCounted: number
  totalMinutes: number
  message: string
}

// minutesPerWeek: oldest first, last item = the current week so far.
export const practiceStand = (target: number, minutesPerWeek: number[], totalMinutes: number): PracticeStand => {
  const thisWeek = minutesPerWeek[minutesPerWeek.length - 1] ?? 0
  const past = minutesPerWeek.slice(0, -1).slice(-8)
  const weeksOnTarget = past.filter((m) => target > 0 && m >= target).length
  const hours = totalMinutes >= 60 ? `${Math.round(totalMinutes / 6) / 10} h` : `${totalMinutes} min`
  const consistency = past.length ? ` · ${weeksOnTarget} of the last ${past.length} weeks on target` : ""
  return {
    thisWeek,
    target,
    weeksOnTarget,
    weeksCounted: past.length,
    totalMinutes,
    message: `This week: ${thisWeek} of ${target} min${consistency} · ${hours} in total`,
  }
}

// ---- work projects (client A, due Thursday) --------------------------

export type Risk = "DONE" | "ON_TRACK" | "TIGHT" | "AT_RISK" | "LATE" | "NO_DEADLINE"

export interface WorkStand {
  done: number
  total: number
  risk: Risk
  daysLeft: number | null
  message: string
}

export const workStand = (
  done: number,
  total: number,
  deadlineKey: string | null,
  todayKey: string,
  donePerWeekRecently: number,
): WorkStand => {
  const remaining = total - done
  const counts = `${done} of ${total} done`
  if (total > 0 && remaining === 0) return { done, total, risk: "DONE", daysLeft: null, message: `${counts} · finished` }
  if (!deadlineKey) return { done, total, risk: "NO_DEADLINE", daysLeft: null, message: `${counts} · no deadline set` }
  const daysLeft = Math.round((Date.parse(`${deadlineKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY)
  if (daysLeft < 0) return { done, total, risk: "LATE", daysLeft, message: `${counts} · ${-daysLeft} day${daysLeft === -1 ? "" : "s"} past the deadline` }
  const need = remaining / Math.max(daysLeft, 1)
  const rate = donePerWeekRecently > 0 ? donePerWeekRecently / 7 : 0.5
  const ratio = need / rate
  const risk: Risk = ratio <= 0.8 ? "ON_TRACK" : ratio <= 1.2 ? "TIGHT" : "AT_RISK"
  const label = { ON_TRACK: "on track", TIGHT: "tight", AT_RISK: "at risk" }[risk]
  const when = daysLeft === 0 ? "due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
  return { done, total, risk, daysLeft, message: `${counts} · ${when} · ${label}` }
}

// ---- habit lifecycle (plan G3): new → building → automatic ------------

export type Stage = "NEW" | "BUILDING" | "AUTOMATIC"

export interface HabitLifeInput {
  createdAt: Date
  frequency: "DAILY" | "WEEKLY" | "CUSTOM"
  weeklyTarget: number | null
  specificDays: string[]
  completedDayKeys: Set<string> // local day keys with a completed log
  todayKey: string
  stage: Stage
}

const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

// Rate per 7-day block, newest first: done days against what was expected.
export const weeklyRates = (h: HabitLifeInput, weeks: number): number[] => {
  const expected = h.frequency === "WEEKLY" ? (h.weeklyTarget ?? 1) : h.frequency === "CUSTOM" ? Math.max(h.specificDays.length, 1) : 7
  return Array.from({ length: weeks }, (_, w) => {
    let done = 0
    for (let d = 0; d < 7; d++) if (h.completedDayKeys.has(addDays(h.todayKey, -(w * 7 + d)))) done++
    return Math.min(1, done / expected)
  })
}

export interface HabitLife {
  stage: Stage
  consistency28: number // completed days in the last 28
  rate8: number | null
  message: string
}

export const GRADUATE_RATE = 0.8
export const GRADUATE_WEEKS = 8

export const habitLife = (h: HabitLifeInput): HabitLife => {
  const ageDays = (Date.parse(`${h.todayKey}T00:00:00Z`) - Date.parse(`${h.createdAt.toISOString().slice(0, 10)}T00:00:00Z`)) / DAY
  const rates = weeklyRates(h, GRADUATE_WEEKS)
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const rate8 = ageDays >= GRADUATE_WEEKS * 7 ? avg(rates) : null
  let consistency28 = 0
  for (let d = 0; d < 28; d++) if (h.completedDayKeys.has(addDays(h.todayKey, -d))) consistency28++

  let stage: Stage = ageDays < 14 ? "NEW" : "BUILDING"
  if (rate8 !== null && rate8 >= GRADUATE_RATE) stage = "AUTOMATIC"
  // An automatic habit that has really slipped goes back to building, quietly.
  if (h.stage === "AUTOMATIC" && stage !== "AUTOMATIC" && avg(rates.slice(0, 4)) >= 0.5) stage = "AUTOMATIC"
  const message = `${consistency28} of the last 28 days`
  return { stage, consistency28, rate8, message }
}
