import { describe, expect, it } from "vitest"
import { bucketFor, groupByBlock, groupByDay, type PlanItem } from "./plan.rules.js"

const item = (over: Partial<PlanItem> & { id: string }): PlanItem => ({
  type: "TASK", title: over.id, block: "ANYTIME", minutes: null, done: false, at: null, dueKey: null, ...over,
})

describe("buckets", () => {
  const today = "2026-10-08"
  it("today, this week, carried, later", () => {
    expect(bucketFor("2026-10-08", today)).toBe("TODAY")
    expect(bucketFor("2026-10-09", today)).toBe("WEEK")
    expect(bucketFor("2026-10-14", today)).toBe("WEEK")
    expect(bucketFor("2026-10-15", today)).toBe("LATER")
    expect(bucketFor("2026-10-01", today)).toBe("CARRIED")
    expect(bucketFor(null, today)).toBe("LATER")
  })
})

describe("today by part of the day", () => {
  it("orders the blocks morning to night and drops empty ones", () => {
    const groups = groupByBlock([item({ id: "e", block: "EVENING" }), item({ id: "m", block: "MORNING" }), item({ id: "a" })])
    expect(groups.map((g) => g.block)).toEqual(["MORNING", "EVENING", "ANYTIME"])
  })
  it("timed reminders first, then to-do, then done", () => {
    const [g] = groupByBlock([
      item({ id: "done", done: true }),
      item({ id: "later", priorityRank: 2 }),
      item({ id: "urgent", priorityRank: 0 }),
      item({ id: "7pm", type: "REMINDER", at: "2026-10-08T13:30:00.000Z" }),
      item({ id: "5pm", type: "REMINDER", at: "2026-10-08T11:30:00.000Z" }),
    ])
    expect(g!.items.map((i) => i.id)).toEqual(["5pm", "7pm", "urgent", "later", "done"])
  })
})

describe("the week", () => {
  it("groups by day in date order", () => {
    const days = groupByDay([item({ id: "b", dueKey: "2026-10-10" }), item({ id: "a", dueKey: "2026-10-09" }), item({ id: "c", dueKey: "2026-10-10" })])
    expect(days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-10"])
    expect(days[1]!.items.map((i) => i.id)).toEqual(["b", "c"])
  })
})
