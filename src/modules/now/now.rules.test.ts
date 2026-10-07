import { describe, expect, it } from "vitest"
import {
  blockAt,
  capacityGuard,
  defaultDay,
  fitsBlock,
  normalizeDay,
  remainingFreeToday,
  rightNow,
  toMin,
  type NowCandidate,
  type NowInput,
} from "./now.rules.js"

const cand = (over: Partial<NowCandidate> & { sourceId: string }): NowCandidate => ({
  sourceType: "TASK",
  title: over.sourceId,
  block: null,
  sizeMinutes: null,
  minimum: null,
  tier: "MAINTAIN",
  dueKey: null,
  order: 0,
  areaName: null,
  goalTitle: null,
  goalWhy: null,
  ...over,
})

const input = (over: Partial<NowInput>): NowInput => ({
  nowMin: toMin("11:00"),
  todayKey: "2026-10-07",
  weekday: 3,
  dayOfMonth: 7,
  blocks: defaultDay(3),
  mode: "NORMAL",
  minutes: null,
  gapDays: 0,
  candidates: [],
  ...over,
})

describe("the day", () => {
  it("finds the block for a time", () => {
    expect(blockAt(defaultDay(3), toMin("11:00")).block).toBe("OFFICE")
    expect(blockAt(defaultDay(3), toMin("20:00")).block).toBe("EVENING")
    expect(blockAt(defaultDay(3), toMin("03:00")).block).toBe("NIGHT")
  })
  it("fills a whole day around 'I work 10 to 8:30'", () => {
    const day = normalizeDay([{ block: "OFFICE", start: "10:00", end: "20:30" }])!
    expect(day.map((b) => b.block)).toEqual(["MORNING", "OFFICE", "EVENING", "NIGHT"])
    expect(day.find((b) => b.block === "OFFICE")!.freeMinutes).toBe(0)
  })
  it("rejects nonsense and overlaps", () => {
    expect(normalizeDay("later")).toBeNull()
    expect(normalizeDay([{ block: "OFFICE", start: "25:00", end: "26:00" }])).toBeNull()
    const day = normalizeDay([
      { block: "OFFICE", start: "09:00", end: "18:00" },
      { block: "GYM", start: "17:00", end: "18:30" },
    ])!
    expect(day.filter((b) => b.block === "GYM")).toHaveLength(0)
  })
  it("counts the free time left today", () => {
    expect(remainingFreeToday(defaultDay(3), toMin("20:30"))).toBe(Math.round(90 * (90 / 180) + 30))
  })
})

describe("fits the block", () => {
  it("office hours take only office items", () => {
    expect(fitsBlock("OFFICE", "OFFICE")).toBe(true)
    expect(fitsBlock(null, "OFFICE")).toBe(false)
    expect(fitsBlock("EVENING", "OFFICE")).toBe(false)
  })
  it("anytime items fit outside office hours; block items only their block", () => {
    expect(fitsBlock(null, "EVENING")).toBe(true)
    expect(fitsBlock("GYM", "EVENING")).toBe(false)
  })
})

describe("right now", () => {
  it("sick mode: rest only, nothing offered", () => {
    const r = rightNow(input({ mode: "SICK", candidates: [cand({ sourceId: "a", block: "OFFICE" })] }))
    expect(r.kind).toBe("REST")
    expect(r.options).toHaveLength(0)
  })
  it("office hours: deadline first, then priority", () => {
    const r = rightNow(
      input({
        candidates: [
          cand({ sourceId: "ui", block: "OFFICE", dueKey: "2026-10-14", priority: "MEDIUM" }),
          cand({ sourceId: "api", block: "OFFICE", dueKey: "2026-10-08", priority: "HIGH" }),
          cand({ sourceId: "gym", block: null, tier: "MAIN" }),
        ],
      }),
    )
    expect(r.options.map((o) => o.sourceId)).toEqual(["api", "ui"])
    expect(r.message).toMatch(/Due 2026-10-08/)
  })
  it("evening: Main area first, sized to the minutes said", () => {
    const r = rightNow(
      input({
        nowMin: toMin("21:45"),
        minutes: 20,
        candidates: [
          cand({ sourceId: "long", tier: "MAIN", sizeMinutes: 60, minimum: "Read one page" }),
          cand({ sourceId: "read", tier: "MAIN", sizeMinutes: 20 }),
          cand({ sourceId: "chore", tier: "MAINTAIN", sizeMinutes: 15 }),
        ],
      }),
    )
    expect(r.options[0]!.sourceId).toBe("read")
    expect(r.options.find((o) => o.sourceId === "long")!.smaller).toBe(true)
    expect(r.options.every((o) => o.minutes <= 20)).toBe(true)
  })
  it("offers rest with an intention when nothing fits the minutes", () => {
    const r = rightNow(input({ nowMin: toMin("21:45"), minutes: 5, candidates: [cand({ sourceId: "big", sizeMinutes: 60 })] }))
    expect(r.kind).toBe("REST")
    expect(r.message).toMatch(/Rest on purpose/)
  })
  it("after 2+ days away: smallest version only, no guilt", () => {
    const r = rightNow(
      input({ nowMin: toMin("20:00"), gapDays: 3, candidates: [cand({ sourceId: "a", tier: "MAIN", sizeMinutes: 40, minimum: "Open the file" })] }),
    )
    expect(r.smaller).toBe(true)
    expect(r.options[0]!.minutes).toBe(2)
    expect(r.message).toMatch(/No restart needed/)
  })
  it("after 2 weeks: a warm welcome and one clean step", () => {
    const r = rightNow(
      input({
        nowMin: toMin("20:00"),
        gapDays: 15,
        candidates: [cand({ sourceId: "a", tier: "MAIN" }), cand({ sourceId: "b", tier: "MAIN" })],
      }),
    )
    expect(r.welcomeBack).toBe(true)
    expect(r.options).toHaveLength(1)
    expect(r.message).toMatch(/Welcome back/)
  })
  it("busy mode asks for minimums only", () => {
    const r = rightNow(input({ nowMin: toMin("20:00"), mode: "BUSY", candidates: [cand({ sourceId: "a", sizeMinutes: 30 })] }))
    expect(r.options[0]!.minutes).toBe(2)
  })
})

describe("capacity guard", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `t${i}`, minutes: 20, rank: i }))
  it("proposes what to keep and what to move", () => {
    const g = capacityGuard(items, 90)
    expect(g.over).toBe(true)
    expect(g.keep).toEqual(["t0", "t1", "t2", "t3"])
    expect(g.move).toHaveLength(8)
    expect(g.message).toMatch(/4 h planned for 1\.5 h/)
  })
  it("says nothing when it fits", () => {
    expect(capacityGuard(items.slice(0, 2), 90).over).toBe(false)
  })
})
