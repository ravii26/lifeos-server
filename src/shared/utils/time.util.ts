/* ===================================================================
   Timezone-aware day helpers. "Today", streaks and scores are computed
   against the USER's timezone, not server UTC.

   Storage convention:
     - Habit-log dates are stored as @db.Date = midnight UTC of the user's
       LOCAL calendar day. Read the calendar day back with utcDayKey (the
       value is already the local day, anchored at midnight UTC).
     - A live instant ("now", a task.completedAt timestamp) is mapped to the
       user's local calendar day with dayKeyInTz.
   =================================================================== */

// Calendar-day key ("YYYY-MM-DD") from the UTC components of a Date. Use for
// values stored as @db.Date (midnight-UTC, date-only).
export const utcDayKey = (d: Date): string =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10)

// Calendar-day key ("YYYY-MM-DD") for an instant, in the given IANA timezone.
// Built from formatToParts so it never depends on locale string ordering.
export const dayKeyInTz = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}`
}

// Today's calendar-day key in the user's timezone.
export const todayKeyInTz = (timeZone: string, now: Date = new Date()): string =>
  dayKeyInTz(now, timeZone)

// Hour of day (0-23) for an instant in the given timezone.
export const hourInTz = (timeZone: string, now: Date = new Date()): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now)
  return parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24
}

// Coarse part of day from the local hour — shared by every AI prompt that
// wants to reason about "right now" (decisions engine, capture classifier).
export const timeOfDayLabel = (timeZone: string, now: Date = new Date()): string => {
  const h = hourInTz(timeZone, now)
  if (h < 6) return "night"
  if (h < 12) return "morning"
  if (h < 17) return "afternoon"
  return "evening"
}

// Weekday name ("Monday") for an instant in the given timezone.
export const weekdayInTz = (timeZone: string, now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now)

// Midnight-UTC Date for a "YYYY-MM-DD" key — the anchor for day arithmetic and
// the @db.Date storage value for that calendar day.
export const dateFromKey = (key: string): Date => new Date(`${key}T00:00:00.000Z`)

// The @db.Date value (midnight UTC) for the local calendar day an instant falls
// on — used when storing a "log for now" in the user's timezone.
export const localDateOnly = (date: Date, timeZone: string): Date =>
  dateFromKey(dayKeyInTz(date, timeZone))

// Add n days to a midnight-UTC date.
export const addUtcDays = (d: Date, n: number): Date => {
  const c = new Date(d)
  c.setUTCDate(c.getUTCDate() + n)
  return c
}

// Whole days from key a → key b (b minus a).
export const daysBetweenKeys = (a: string, b: string): number =>
  Math.round((dateFromKey(b).getTime() - dateFromKey(a).getTime()) / 86_400_000)

// Timezone offset in minutes (east of UTC positive) at a given instant, read
// from Intl's short-offset name (e.g. "GMT+5:30" → 330, "GMT-7" → -420).
export const tzOffsetMinutes = (instant: Date, timeZone: string): number => {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(instant)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+0"
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!m) return 0
  const sign = m[1] === "-" ? -1 : 1
  return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0))
}

// UTC instant (ms) of local midnight starting calendar day `key` ("YYYY-MM-DD")
// in `timeZone`. Offset is sampled at local noon to dodge the DST-midnight edge,
// so this is exact for fixed-offset zones and every non-transition day.
export const localDayStartMs = (key: string, timeZone: string): number => {
  const noon = new Date(`${key}T12:00:00.000Z`)
  const offMin = tzOffsetMinutes(noon, timeZone)
  return Date.parse(`${key}T00:00:00.000Z`) - offMin * 60_000
}
