import { describe, expect, it } from "vitest"
import { DayTally, lookBackMonth, routineDots, routineLine, weekKeys, weekLabel } from "./week.rules.js"

const keys = weekKeys("2026-11-16") // Monday 16 to Sunday 22 Nov
const today = "2026-11-19" // Thursday

describe("the week", () => {
  it("is seven days from Monday", () => {
    expect(keys[0]).toBe("2026-11-16")
    expect(keys[6]).toBe("2026-11-22")
  })
  it("is labelled plainly, across a month too", () => {
    expect(weekLabel("2026-11-16")).toBe("16 – 22 Nov")
    expect(weekLabel("2026-11-30")).toBe("30 Nov – 6 Dec")
  })
})

describe("minutes per area per day", () => {
  it("one thing timed and ticked counts once, the larger", () => {
    const t = new DayTally()
    t.add("a", "2026-11-16", "TASK:1", 25, "timed")
    t.add("a", "2026-11-16", "TASK:1", 30, "logged")
    t.add("a", "2026-11-16", "HABIT:2", 10, "logged")
    t.add("b", "2026-11-17", "PROJECT:3", 40, "timed")
    const m = t.byAreaAndDay()
    expect(m.get("a")!.get("2026-11-16")).toBe(40)
    expect(m.get("b")!.get("2026-11-17")).toBe(40)
  })
})

describe("routines as seven dots", () => {
  const daily = { frequency: "DAILY", specificDays: [], weeklyTarget: null }
  it("done is filled; gone days stay neutral; ahead is planned", () => {
    const dots = routineDots(daily, new Set(["2026-11-16", "2026-11-18"]), keys, today)
    expect(dots).toEqual(["DONE", "PAST", "DONE", "PLANNED", "PLANNED", "PLANNED", "PLANNED"])
    expect(routineLine(daily, dots)).toBe("2 of 7 this week")
  })
  it("set days only", () => {
    const h = { frequency: "CUSTOM", specificDays: ["MON", "THU"], weeklyTarget: null }
    const dots = routineDots(h, new Set(["2026-11-16"]), keys, today)
    expect(dots).toEqual(["DONE", "OFF", "OFF", "PLANNED", "OFF", "OFF", "OFF"])
    expect(routineLine(h, dots)).toBe("1 of 2 this week")
  })
  it("a few times a week: any day will do", () => {
    const h = { frequency: "WEEKLY", specificDays: [], weeklyTarget: 3 }
    const dots = routineDots(h, new Set(["2026-11-17"]), keys, today)
    expect(dots.filter((d) => d === "OFF")).toHaveLength(6)
    expect(routineLine(h, dots)).toBe("1 of 3 this week")
  })
})

describe("looking back", () => {
  it("in the first week of a month, the month before", () => {
    expect(lookBackMonth("2026-12-03")).toEqual({ month: "November", from: "2026-11-01", to: "2026-11-30" })
    expect(lookBackMonth("2027-01-07")).toEqual({ month: "December", from: "2026-12-01", to: "2026-12-31" })
  })
  it("not later in the month", () => {
    expect(lookBackMonth("2026-12-08")).toBeNull()
  })
})
