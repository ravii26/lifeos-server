// One tracked number per goal: where it started, where it is, where it is
// going, and the last few readings for a small trend line. Pure rules.

export const POINTS = 12

export interface Reading {
  value: number
  at: Date
}

// The last few readings, oldest first, for the line on the area page.
export const lastPoints = (entries: Reading[], n = POINTS): { value: number; at: string }[] =>
  [...entries]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-n)
    .map((e) => ({ value: e.value, at: e.at.toISOString() }))

export interface NewNumber {
  name: string
  unit: string
  start: number
  target: number
}

// A number worth tracking has a name, a start and a target that differ.
export const cleanNumber = (raw: { name?: unknown; unit?: unknown; start?: unknown; target?: unknown }): NewNumber | string => {
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ").slice(0, 60) : ""
  if (!name) return "Give the number a name, like Weight or Savings."
  const unit = typeof raw.unit === "string" ? raw.unit.trim().slice(0, 20) : ""
  const start = Number(raw.start)
  const target = Number(raw.target)
  if (!Number.isFinite(start) || !Number.isFinite(target)) return "Say where it is now and where you want it."
  if (start === target) return "The goal is where it already is. Pick a different target."
  return { name, unit, start, target }
}
