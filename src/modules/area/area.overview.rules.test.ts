import { describe, expect, it } from "vitest"
import { capacity, itemMinutes, modeOfTier, span, standing, tierOfMode, weekStartKey, type AreaWeek } from "./area.overview.rules.js"

const week = (over: Partial<AreaWeek>): AreaWeek => ({
  mode: "PUSH", weeklyMinutes: null, projectMinutes: 0, minutes: 0, activeDays: 0, lastKey: null, todayKey: "2026-11-14", restUntilKey: null, ...over,
})

describe("modes", () => {
  it("every tier has a mode and maps back to itself", () => {
    for (const tier of ["MAIN", "SECONDARY", "MAINTAIN", "LATER"]) expect(tierOfMode(modeOfTier(tier))).toBe(tier)
    expect(modeOfTier("MAIN")).toBe("PUSH")
    expect(modeOfTier("LATER")).toBe("REST")
  })
  it("an unknown tier is treated as Maintain", () => {
    expect(modeOfTier("SOMETHING")).toBe("MAINTAIN")
  })
})

describe("the week", () => {
  it("starts on Monday", () => {
    expect(weekStartKey("2026-11-14")).toBe("2026-11-09") // a Saturday
    expect(weekStartKey("2026-11-09")).toBe("2026-11-09") // a Monday
    expect(weekStartKey("2026-11-15")).toBe("2026-11-09") // a Sunday
    expect(weekStartKey("2026-11-16")).toBe("2026-11-16")
  })
  it("says lengths plainly", () => {
    expect(span(45)).toBe("45 min")
    expect(span(120)).toBe("2h")
    expect(span(130)).toBe("2h 10")
    expect(span(65)).toBe("1h 05")
  })
  it("counts one thing once when it was both timed and ticked", () => {
    expect(itemMinutes(25, 30)).toBe(30)
    expect(itemMinutes(40, 0)).toBe(40)
  })
})

describe("where an area stands", () => {
  it("against the time the person set", () => {
    const s = standing(week({ weeklyMinutes: 300, projectMinutes: 600, minutes: 130 }))
    expect(s.plannedMinutes).toBe(300)
    expect(s.status).toBe("2h 10 of 5h this week")
    expect(s.value).toBeCloseTo(130 / 300)
  })
  it("falls back to its goals' weekly targets", () => {
    expect(standing(week({ projectMinutes: 240, minutes: 60 })).status).toBe("1h of 4h this week")
  })
  it("never shows more than a full spoke", () => {
    expect(standing(week({ weeklyMinutes: 60, minutes: 200 })).value).toBe(1)
  })
  it("with no time plan, counts days against what the mode expects", () => {
    expect(standing(week({ mode: "PUSH", activeDays: 2 })).value).toBe(0.5)
    expect(standing(week({ mode: "MAINTAIN", activeDays: 2 })).value).toBe(1)
    expect(standing(week({ mode: "EXPLORE", activeDays: 1 })).status).toBe("Active 1 day this week")
  })
  it("says when it was last touched, without blame", () => {
    expect(standing(week({ lastKey: "2026-11-05" })).status).toBe("Last touched 9 days ago")
    expect(standing(week({ lastKey: "2026-11-13" })).status).toBe("Last touched yesterday")
    expect(standing(week({})).status).toBe("Not started yet")
  })
  it("a resting area asks for nothing", () => {
    const s = standing(week({ mode: "REST", weeklyMinutes: 300, minutes: 0, restUntilKey: "2026-12-12" }))
    expect(s).toEqual({ plannedMinutes: 0, value: 0, status: "Resting until 12 Dec" })
    expect(standing(week({ mode: "REST", restUntilKey: "2026-11-01" })).status).toBe("Resting")
  })
})

describe("hours needed against free", () => {
  const plan = [
    { mode: "PUSH" as const, plannedMinutes: 600 },
    { mode: "MAINTAIN" as const, plannedMinutes: 120 },
    { mode: "REST" as const, plannedMinutes: 300 },
  ]
  it("suggests, and never blocks, when the week asks for too much", () => {
    const c = capacity(plan, 600)
    expect(c.neededMinutes).toBe(720)
    expect(c.over).toBe(true)
    expect(c.note).toContain("12h")
    expect(c.note).toContain("10h")
  })
  it("says nothing when it fits, or when free time is not known", () => {
    expect(capacity(plan, 900).note).toBeNull()
    expect(capacity(plan, 0).over).toBe(false)
  })
})
