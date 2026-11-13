import { describe, it, expect } from "vitest"
import { decideCheckin, weightLine, type SessionState } from "./checkin.rules.js"

const gym: SessionState = { key: "STRENGTH", habitId: "g", title: "Gym", minutes: 40, days: ["MON", "WED", "FRI"], fullDays: ["MON", "WED", "FRI"] }
const walkWeek1: SessionState = { key: "WALK", habitId: "w", title: "Walk", minutes: 30, days: ["SAT"], fullDays: ["TUE", "THU", "SAT"] }

describe("decideCheckin", () => {
  it("under half done → lighter sessions, and week-1 walks stay capped", () => {
    const d = decideCheckin([gym, walkWeek1], { done: 1, planned: 4 }, 0, 2)
    expect(d.verdict).toBe("LIGHTER")
    expect(d.sessions[0]).toMatchObject({ minutes: 30, changed: "30 min instead of 40" })
    expect(d.sessions[1]).toMatchObject({ minutes: 25, days: ["SAT"] })
    expect(d.message).toMatch(/lighter/)
  })

  it("3 of 4 → same plan, and the walks fill out from week 2", () => {
    const d = decideCheckin([gym, walkWeek1], { done: 3, planned: 4 }, 0, 2)
    expect(d.verdict).toBe("SAME")
    expect(d.sessions[0]).toMatchObject({ minutes: 40, changed: null })
    expect(d.sessions[1]).toMatchObject({ minutes: 30, days: ["TUE", "THU", "SAT"], changed: "now Tue, Thu, Sat" })
    expect(d.fullInARow).toBe(0)
  })

  it("one full week → same; two in a row → 5 minutes harder, never past 60", () => {
    const full = { ...walkWeek1, days: walkWeek1.fullDays }
    const one = decideCheckin([gym, full], { done: 6, planned: 6 }, 0, 3)
    expect(one.verdict).toBe("SAME")
    expect(one.fullInARow).toBe(1)
    const two = decideCheckin([gym, full], { done: 6, planned: 6 }, 1, 4)
    expect(two.verdict).toBe("HARDER")
    expect(two.sessions[0]).toMatchObject({ minutes: 45, changed: "45 min, 5 more" })
    const top = decideCheckin([{ ...gym, minutes: 60 }], { done: 3, planned: 3 }, 3, 6)
    expect(top.sessions[0]).toMatchObject({ minutes: 60, changed: null })
  })

  it("never goes below 15 minutes", () => {
    const d = decideCheckin([{ ...gym, minutes: 15 }], { done: 0, planned: 3 }, 0, 2)
    expect(d.sessions[0]!.minutes).toBe(15)
    expect(d.sessions[0]!.changed).toBeNull()
  })
})

describe("weightLine", () => {
  it("speaks about the trend, never one day", () => {
    expect(weightLine(83, 82.5)).toBe("82.5 kg, 0.5 down since last week.")
    expect(weightLine(82.5, 83)).toMatch(/3-week trend/)
    expect(weightLine(null, 83)).toMatch(/logged/)
    expect(weightLine(83, null)).toBeNull()
  })
})
