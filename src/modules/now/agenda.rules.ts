/* =====================================================================
   The proactive agenda (plan 16 §3, ADR 0027): what Ally says on its own
   today, and when. Pure code and templates, no AI, so it keeps working
   when the AI is down and costs nothing.

   - Briefing at wake time: the day in up to four lines.
   - Slot nudges at the start of each free part of the day that has
     something planned (Normal only).
   - Wrap-up before sleep: what got done, what's left, "move it to tomorrow?".
   - Sunday review before the wrap-up.
   Quiet hours are the person's own night (sleep → wake). Sick, travel and
   holiday send nothing; busy keeps only the briefing and wrap-up.
   ===================================================================== */
import { toMin, type Block, type DayBlock, type Mode, type SuggestedBlock } from "./now.rules.js"

export type Proactivity = "NORMAL" | "QUIETER" | "SILENT"
export const PROACTIVITY: Proactivity[] = ["NORMAL", "QUIETER", "SILENT"]

export type AgendaKind = "BRIEFING" | "SLOT" | "WRAP_UP" | "WEEKLY_REVIEW"
export type AgendaActionId = "DONE" | "SKIP" | "MOVE_LEFT"

export interface AgendaItem {
  key: string // stable per day and kind, so the phone replaces instead of duplicating
  kind: AgendaKind
  dayKey: string
  atMin: number // minutes after local midnight
  title: string
  body: string
  actions: { id: AgendaActionId; label: string }[]
  // The thing DONE / SKIP answer (slot nudges).
  sourceType?: "TASK" | "HABIT" | "PROJECT"
  sourceId?: string
  minutes?: number
  count?: number | null
}

export interface AgendaDayInput {
  dayKey: string
  weekday: number // 0 = Sunday
  nowMin: number // items at or before this are not sent; -1 plans the whole day
  isToday: boolean // done / left lists are only true for today
  blocks: DayBlock[]
  suggested: SuggestedBlock[]
  mode: Mode
  level: Proactivity
  busyUntilMin: number | null
  wrapUpAt: string | null // the person's own evening time (nightlyTime), if set
  due: { title: string; when: "today" | "tomorrow" }[]
  doneToday: string[]
  leftToday: string[]
  week: string[] // lines for the Sunday review
}

export const MAX_SLOTS = 3
export const MAX_PER_DAY = 8
const MERGE_WITHIN = 30 // a slot this close to the briefing or wrap-up is folded into it

const BLOCK_NAME: Record<Block, string> = {
  MORNING: "Morning",
  COMMUTE: "Commute",
  OFFICE: "Office",
  GYM: "Gym",
  EVENING: "Evening",
  NIGHT: "Tonight",
}

const fmt = (m: number): string => {
  const h = Math.floor(m / 60) % 24
  const mm = m % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`
}

const itemLine = (i: { title: string; minutes: number }) => (i.minutes > 0 ? `${i.title} ${i.minutes} min` : i.title)

const list = (xs: string[], max = 3): string => {
  const shown = xs.slice(0, max)
  const more = xs.length - shown.length
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`
}

export const wakeMin = (blocks: DayBlock[]): number => (blocks.length ? toMin(blocks[0]!.start) : 7 * 60)
export const sleepMin = (blocks: DayBlock[]): number => (blocks.length ? toMin(blocks[blocks.length - 1]!.end) : 23 * 60)

// "Office 10 am–8:30 pm. Before office: DSA 45 min, water. After: gym 15 min,
// read 20 min. Due today: report."
export const briefingBody = (d: AgendaDayInput): string => {
  const office = d.blocks.find((b) => b.block === "OFFICE")
  const lines: string[] = []
  if (office) lines.push(`Office ${fmt(toMin(office.start))}–${fmt(toMin(office.end))}.`)
  if (d.mode === "BUSY") lines.push("Busy week: only the smallest versions.")
  const officeStart = office ? toMin(office.start) : Infinity
  const before = d.suggested.filter((b) => toMin(b.start) < officeStart).flatMap((b) => b.items.map(itemLine))
  const after = d.suggested.filter((b) => toMin(b.start) >= officeStart).flatMap((b) => b.items.map(itemLine))
  if (office) {
    if (before.length) lines.push(`Before office: ${list(before)}.`)
    if (after.length) lines.push(`After: ${list(after)}.`)
  } else if (before.length) {
    lines.push(`Today: ${list(before, 4)}.`)
  }
  const dueToday = d.due.filter((x) => x.when === "today").map((x) => x.title)
  const dueTomorrow = d.due.filter((x) => x.when === "tomorrow").map((x) => x.title)
  if (dueToday.length) lines.push(`Due today: ${list(dueToday, 2)}.`)
  else if (dueTomorrow.length) lines.push(`Due tomorrow: ${list(dueTomorrow, 2)}.`)
  if (lines.length === (office ? 1 : 0) + (d.mode === "BUSY" ? 1 : 0)) lines.push("Nothing planned yet. Tell me what matters today.")
  return lines.slice(0, 4).join("\n")
}

export const wrapUpBody = (d: AgendaDayInput): { body: string; canMove: boolean } => {
  if (!d.isToday) return { body: "See what got done today and move what's left to tomorrow.", canMove: false }
  const done = d.doneToday.length
    ? `Done today: ${list(d.doneToday)}.`
    : "Nothing ticked today, and that's okay."
  if (!d.leftToday.length) return { body: `${done} Nothing left. Rest well.`, canMove: false }
  return { body: `${done} Still open: ${list(d.leftToday)}. Move ${d.leftToday.length === 1 ? "it" : "them"} to tomorrow?`, canMove: true }
}

export const agendaForDay = (d: AgendaDayInput): AgendaItem[] => {
  if (d.level === "SILENT" || d.mode === "SICK" || d.mode === "TRAVEL" || d.mode === "HOLIDAY" || !d.blocks.length) return []
  const wake = wakeMin(d.blocks)
  const sleep = sleepMin(d.blocks)
  // Quiet hours are the person's own night: nothing before waking or after sleep.
  const awake = (m: number) => m >= wake && m < sleep
  const items: AgendaItem[] = []

  items.push({
    key: `${d.dayKey}:BRIEFING`,
    kind: "BRIEFING",
    dayKey: d.dayKey,
    atMin: wake,
    title: d.weekday === 0 || d.weekday === 6 ? "Your weekend day" : "Your day",
    body: briefingBody(d),
    actions: [],
  })

  const own = d.wrapUpAt ? toMin(d.wrapUpAt) : null
  const wrapAt = own !== null && awake(own) ? own : Math.max(wake + 60, sleep - 30)
  const wrap = wrapUpBody(d)
  items.push({
    key: `${d.dayKey}:WRAP_UP`,
    kind: "WRAP_UP",
    dayKey: d.dayKey,
    atMin: wrapAt,
    title: "Wrap up today",
    body: wrap.body,
    actions: wrap.canMove ? [{ id: "MOVE_LEFT", label: "Move to tomorrow" }] : [],
  })

  if (d.weekday === 0) {
    items.push({
      key: `${d.dayKey}:WEEKLY_REVIEW`,
      kind: "WEEKLY_REVIEW",
      dayKey: d.dayKey,
      atMin: Math.max(wake + 60, wrapAt - 60),
      title: "Your week",
      body: d.week.length ? `${d.week.slice(0, 3).join("\n")}\nTap to plan next week.` : "Tap to look back at the week and plan the next one.",
      actions: [],
    })
  }

  // Slot nudges: Normal only, never while busy, at most three, never right
  // next to the briefing or wrap-up (those already say it).
  if (d.level === "NORMAL" && d.mode === "NORMAL") {
    let slots = 0
    for (const b of d.suggested) {
      const at = toMin(b.start)
      const first = b.items[0]
      if (!first || slots >= MAX_SLOTS) continue
      if (Math.abs(at - wake) < MERGE_WITHIN || Math.abs(at - wrapAt) < MERGE_WITHIN) continue
      if (d.busyUntilMin !== null && at < d.busyUntilMin) continue
      const rest = b.items.slice(1).map(itemLine)
      items.push({
        key: `${d.dayKey}:SLOT:${b.block}`,
        kind: "SLOT",
        dayKey: d.dayKey,
        atMin: at,
        title: `${BLOCK_NAME[b.block]}: ${itemLine(first)}`,
        body: [first.why, rest.length ? `Then: ${list(rest)}.` : ""].filter(Boolean).join("\n"),
        actions: [
          { id: "DONE", label: "Done" },
          { id: "SKIP", label: "Not now" },
        ],
        sourceType: first.sourceType,
        sourceId: first.sourceId,
        minutes: first.minutes,
        count: first.count,
      })
      slots++
    }
  }

  return items
    .filter((i) => awake(i.atMin) && i.atMin > d.nowMin)
    .sort((a, b) => a.atMin - b.atMin)
    .slice(0, MAX_PER_DAY)
}
