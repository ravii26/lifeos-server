import { describe, expect, it } from "vitest"
import {
  activeHoldIds,
  ageLine,
  dueLine,
  durationText,
  habitWeeklyMinutes,
  holdReason,
  holdsEnded,
  holdUntil,
  monthName,
  parkedName,
  parkedRows,
  parkUntilKey,
  quietestArea,
  projectWeeklyMinutes,
  rankPile,
  returnedReason,
  type PileItem,
} from "./pile.rules.js"

const item = (over: Partial<PileItem>): PileItem => ({
  sourceType: "TASK",
  sourceId: "x",
  title: "x",
  weeklyMinutes: 30,
  ageDays: 1,
  ageLine: null,
  dueLine: null,
  needs: "",
  ...over,
})

describe("holds", () => {
  it("reads only a well-formed hold", () => {
    expect(holdUntil(holdReason("2027-01-01"))).toBe("2027-01-01")
    expect(holdUntil(returnedReason(holdReason("2027-01-01")))).toBeNull()
    expect(holdUntil("tomorrow")).toBeNull()
    expect(holdUntil(null)).toBeNull()
  })

  it("keeps an item out only until its date", () => {
    const events = [{ itemId: "a", reason: holdReason("2026-11-12") }]
    expect(activeHoldIds(events, "2026-11-11").has("a")).toBe(true)
    expect(activeHoldIds(events, "2026-11-12").has("a")).toBe(false)
  })

  it("uses only the latest hold for an item", () => {
    const newestFirst = [
      { itemId: "a", reason: holdReason("2026-11-11") },
      { itemId: "a", reason: holdReason("2027-01-01") },
    ]
    expect(activeHoldIds(newestFirst, "2026-11-20").has("a")).toBe(false)
  })

  it("does not bring something back twice", () => {
    const returned = [{ itemId: "a", reason: returnedReason(holdReason("2026-11-01")) }]
    expect(holdsEnded(returned, "2026-11-20")).toEqual([])
    const due = [{ itemId: "b", reason: holdReason("2026-11-01") }]
    expect(holdsEnded(due, "2026-11-20").map((e) => e.itemId)).toEqual(["b"])
  })
})

describe("parking", () => {
  it("skips a month that is too close", () => {
    expect(parkUntilKey("2026-11-10")).toBe("2027-01-01")
    expect(parkUntilKey("2026-11-01")).toBe("2026-12-01")
    expect(monthName("2027-01-01")).toBe("January")
  })
})

describe("the parked list", () => {
  const event = (id: string, itemId: string, title: string, until: string) => ({ id, itemId, itemType: "HABIT", title, reason: holdReason(until) })

  it("shows the name and the month, newest hold only", () => {
    const rows = parkedRows([event("e2", "a", "Guitar is parked until January.", "2027-01-01"), event("e1", "a", "Guitar is parked until December.", "2026-12-01")], "2026-11-10")
    expect(rows).toEqual([{ activityId: "e2", itemType: "HABIT", title: "Guitar", until: "2027-01-01", untilLabel: "January" }])
  })

  it("drops what has already come back", () => {
    expect(parkedRows([event("e", "a", "Guitar is parked until December.", "2026-12-01")], "2026-12-01")).toEqual([])
  })

  it("leaves a plain title alone", () => {
    expect(parkedName("Guitar")).toBe("Guitar")
    expect(parkedName(null)).toBe("")
  })
})

describe("the area that went quiet", () => {
  it("picks the longest quiet area, after two weeks", () => {
    expect(quietestArea([{ name: "Work", idleDays: 1, tier: "MAIN" }, { name: "Friends", idleDays: 20, tier: "SECONDARY" }, { name: "Home", idleDays: 15, tier: "MAINTAIN" }])).toBe("Friends")
    expect(quietestArea([{ name: "Work", idleDays: 13, tier: "MAIN" }])).toBeNull()
  })

  it("ignores an area set aside on purpose", () => {
    expect(quietestArea([{ name: "Guitar", idleDays: 30, tier: "LATER" }])).toBeNull()
  })
})

describe("what things cost", () => {
  it("counts how often a habit happens", () => {
    expect(habitWeeklyMinutes({ frequency: "DAILY", weeklyTarget: null, specificDays: [], targetMinutes: 30 })).toBe(210)
    expect(habitWeeklyMinutes({ frequency: "WEEKLY", weeklyTarget: 3, specificDays: [], targetMinutes: 60 })).toBe(180)
    expect(habitWeeklyMinutes({ frequency: "CUSTOM", weeklyTarget: null, specificDays: ["SAT", "SUN"], targetMinutes: null })).toBe(30)
  })

  it("prefers a project's own weekly target", () => {
    expect(projectWeeklyMinutes({ weeklyTargetMinutes: 300, weeklyTargetCount: null, sessionMinutes: null, openTaskMinutes: 90 })).toBe(300)
    expect(projectWeeklyMinutes({ weeklyTargetMinutes: null, weeklyTargetCount: 4, sessionMinutes: 30, openTaskMinutes: 0 })).toBe(120)
    expect(projectWeeklyMinutes({ weeklyTargetMinutes: null, weeklyTargetCount: null, sessionMinutes: null, openTaskMinutes: 90 })).toBe(90)
    expect(projectWeeklyMinutes({ weeklyTargetMinutes: null, weeklyTargetCount: null, sessionMinutes: null, openTaskMinutes: 0 })).toBe(60)
  })
})

describe("plain words", () => {
  it("writes durations a person would say", () => {
    expect(durationText(45)).toBe("45 minutes")
    expect(durationText(60)).toBe("1 hour")
    expect(durationText(100)).toBe("1.5 hours")
    expect(durationText(3600)).toBe("60 hours")
  })

  it("mentions age only once it means something", () => {
    expect(ageLine(5)).toBeNull()
    expect(ageLine(21)).toBe("On your list for 3 weeks")
    expect(ageLine(240)).toBe("On your list for 8 months")
  })

  it("mentions only near dates, with no guilt about past ones", () => {
    expect(dueLine(null, "2026-11-10")).toBeNull()
    expect(dueLine("2026-11-10", "2026-11-10")).toBe("Due today")
    expect(dueLine("2026-11-13", "2026-11-10")).toBe("Due in 3 days")
    expect(dueLine("2027-01-01", "2026-11-10")).toBeNull()
    expect(dueLine("2026-11-01", "2026-11-10")).toBe("The date for this has passed")
  })
})

describe("order", () => {
  it("asks about the biggest commitments first", () => {
    const ranked = rankPile([
      item({ sourceId: "task", sourceType: "TASK", weeklyMinutes: 500 }),
      item({ sourceId: "habit", sourceType: "HABIT", weeklyMinutes: 100 }),
      item({ sourceId: "small", sourceType: "PROJECT", weeklyMinutes: 60 }),
      item({ sourceId: "big", sourceType: "PROJECT", weeklyMinutes: 300 }),
    ])
    expect(ranked.map((i) => i.sourceId)).toEqual(["big", "small", "habit", "task"])
  })
})
