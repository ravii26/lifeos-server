import { describe, it, expect } from "vitest"
import { ladder, nextStep, retimeDay, guidelineNote } from "./sleep.rules.js"
import type { DayBlock } from "../now/now.rules.js"

describe("ladder", () => {
  it("is the agreed plan: wake 8 → one jump to 7, then 6:30, then 6:00, with 7 hours", () => {
    expect(ladder("08:00", "06:00", 420)).toEqual([
      { week: 1, wake: "07:00", sleep: "24:00" },
      { week: 2, wake: "06:30", sleep: "23:30" },
      { week: 3, wake: "06:00", sleep: "23:00" },
    ])
  })

  it("starts at the target when already within an hour of it", () => {
    expect(ladder("06:30", "06:00", 420)).toEqual([
      { week: 1, wake: "06:30", sleep: "23:30" },
      { week: 2, wake: "06:00", sleep: "23:00" },
    ])
    expect(ladder("06:00", "06:00", 480)).toEqual([{ week: 1, wake: "06:00", sleep: "22:00" }])
  })

  it("never makes someone wake later than they already do", () => {
    expect(ladder("05:30", "06:00", 420)).toEqual([{ week: 1, wake: "06:00", sleep: "23:00" }])
  })
})

describe("nextStep", () => {
  it("moves on only after 5 of 7 days kept, and stays without penalty otherwise", () => {
    expect(nextStep(1, 3, 5)).toEqual({ step: 2, moved: true, done: false })
    expect(nextStep(2, 3, 6)).toEqual({ step: 3, moved: true, done: true })
    expect(nextStep(2, 3, 4)).toEqual({ step: 2, moved: false, done: false })
    expect(nextStep(3, 3, 7)).toEqual({ step: 3, moved: false, done: true })
  })
})

describe("retimeDay", () => {
  const weekday: DayBlock[] = [
    { block: "MORNING", start: "06:00", end: "09:30", freeMinutes: 30 },
    { block: "OFFICE", start: "09:30", end: "19:00", freeMinutes: 0 },
    { block: "EVENING", start: "19:00", end: "22:00", freeMinutes: 90 },
    { block: "NIGHT", start: "22:00", end: "24:00", freeMinutes: 30 },
  ]

  it("moves only the wake and bedtime ends, never the office", () => {
    const d = retimeDay(weekday, "07:00", "23:30")
    expect(d[0]).toMatchObject({ block: "MORNING", start: "07:00", end: "09:30" })
    expect(d[1]).toMatchObject({ block: "OFFICE", start: "09:30", end: "19:00" })
    expect(d[d.length - 1]).toMatchObject({ block: "NIGHT", start: "22:00", end: "23:30" })
  })

  it("drops a block that falls after an earlier bedtime", () => {
    const d = retimeDay(weekday, "06:00", "21:30")
    expect(d.map((b) => b.block)).toEqual(["MORNING", "OFFICE", "EVENING"])
    expect(d[2]).toMatchObject({ end: "21:30" })
  })

  it("writes midnight as 24:00", () => {
    const d = retimeDay(weekday, "07:00", "24:00")
    expect(d[d.length - 1]).toMatchObject({ end: "24:00" })
  })
})

describe("guidelineNote", () => {
  it("speaks once below 7 hours, never at or above", () => {
    expect(guidelineNote(360)).toMatch(/at least 7 hours/)
    expect(guidelineNote(420)).toBeNull()
  })
})
