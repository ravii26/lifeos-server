/* =====================================================================
   Dates are code, not model judgement. When the person names one weekday
   ("due Thursday") and the model's date falls on a different weekday, the
   date moves to the next real occurrence of that weekday.
   ===================================================================== */

import { tokenize } from "../search/search.rules.js"

const NAMES: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
}

const WORD = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|weds|thurs|thur|sun|mon|tue|wed|thu|fri|sat)\b/gi

const weekdayOfKey = (key: string): number => new Date(`${key}T00:00:00Z`).getUTCDay()

const addDays = (key: string, n: number): string => {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// The one weekday a message names, or null when it names none, several, or
// mixes in "today" / "tomorrow" (then the model's reading is kept).
export const namedWeekday = (text: string): number | null => {
  if (/\b(today|tomorrow|tonight|kal|aaj|parso)\b/i.test(text)) return null
  const found = new Set([...text.matchAll(WORD)].map((m) => NAMES[m[1]!.toLowerCase()]!))
  return found.size === 1 ? [...found][0]! : null
}

// Next occurrence of `weekday` strictly after today ("due Thursday" said on a
// Thursday means the coming one).
export const nextWeekdayKey = (weekday: number, todayKey: string): string => {
  const ahead = ((weekday - weekdayOfKey(todayKey) + 7) % 7) || 7
  return addDays(todayKey, ahead)
}

export const correctWeekdayDate = (dateKey: string | null | undefined, text: string, todayKey: string): string | null | undefined => {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey
  const want = namedWeekday(text)
  if (want === null || weekdayOfKey(dateKey) === want) return dateKey
  return nextWeekdayKey(want, todayKey)
}

// ---- per action: each action is judged against its own sentence ---------------------

// The sentence of the message that talks about this action (most shared words
// with its title). One sentence = the whole message. Several with no clear
// match = null: better to keep the model's date than to guess.
export const clauseFor = (text: string, title: string | undefined): string | null => {
  const clauses = text.split(/[.;\n]+/).map((c) => c.trim()).filter(Boolean)
  if (clauses.length <= 1) return clauses[0] ?? text
  const want = new Set(tokenize(title ?? ""))
  if (!want.size) return null
  const scored = clauses.map((c) => ({ c, n: tokenize(c).filter((t) => want.has(t)).length })).sort((a, b) => b.n - a.n)
  return scored[0]!.n > 0 && scored[0]!.n > (scored[1]?.n ?? 0) ? scored[0]!.c : null
}

// Friday of next week: what "UI, next week" means as a deadline.
export const endOfNextWeek = (todayKey: string): string => addDays(nextWeekdayKey(1, todayKey), 4)

const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }

const addMonths = (key: string, n: number): string => {
  const d = new Date(`${key}T00:00:00Z`)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString().slice(0, 10)
}

// "in 6 months", "in two weeks", "in 3 days": arithmetic, not the model's guess.
export const relativeDate = (text: string, todayKey: string): string | null => {
  const m = text.match(/\bin\s+(\d{1,2}|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(day|week|month|year)s?\b/i)
  if (!m) return null
  const n = /^\d/.test(m[1]!) ? Number(m[1]) : COUNT[m[1]!.toLowerCase()]!
  const unit = m[2]!.toLowerCase()
  if (unit === "day") return addDays(todayKey, n)
  if (unit === "week") return addDays(todayKey, n * 7)
  return addMonths(todayKey, unit === "month" ? n : n * 12)
}

// A new to-do or goal is never due in the past, unless the person said it is overdue.
const notPast = (d: string | null | undefined, todayKey: string, clause: string): string | null | undefined =>
  d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < todayKey && !/\b(yesterday|overdue|ago|last week|late)\b/i.test(clause) ? null : d

interface DatedAction {
  type?: string
  title?: string
  due?: string | null
  deadline?: string | null
  tasks?: { title?: string; due?: string | null; priority?: string | null }[]
}

// Fixes weekday dates and fills "next week" for one proposed task or project.
export const correctActionDates = <T extends DatedAction>(a: T, text: string, todayKey: string): T => {
  if (a.type !== "ADD_TASK" && a.type !== "ADD_PROJECT") return a
  const clause = clauseFor(text, a.title)
  if (!clause) return a
  const nextWeek = /\bnext week\b/i.test(clause)
  const fix = (d: string | null | undefined) => notPast(correctWeekdayDate(d, clause, todayKey), todayKey, clause)
  const relative = relativeDate(clause, todayKey)
  const out: T = { ...a }
  if (a.type === "ADD_TASK") {
    if (relative) out.due = relative
    else if (a.due) out.due = fix(a.due)
    else if (nextWeek) out.due = endOfNextWeek(todayKey)
    return out
  }
  if (relative) out.deadline = relative
  else if (a.deadline) out.deadline = fix(a.deadline)
  else if (nextWeek) out.deadline = endOfNextWeek(todayKey)
  if (Array.isArray(a.tasks)) {
    const deadline = out.deadline ?? null
    out.tasks = a.tasks.map((t) => ({ ...t, due: t.due ? fix(t.due) : nextWeek ? deadline : t.due }))
  }
  return out
}
