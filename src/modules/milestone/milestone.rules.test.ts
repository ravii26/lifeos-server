import { describe, expect, it } from "vitest"
import { cleanMilestones, fallbackMilestones, goalProgress, letGoPlan, reachPlan, stepOffered, type MilestoneRow } from "./milestone.rules.js"

const row = (id: string, order: number, status: string, stepsDone = 0, stepsOpen = 0): MilestoneRow => ({ id, title: `M${order + 1}`, order, status, stepsDone, stepsOpen })

describe("cleanMilestones", () => {
  it("keeps titles in order, drops blanks and repeats, at most six", () => {
    expect(cleanMilestones(["Run 2 km", " ", "run 2 km", { title: "Run 5 km." }, 4, "a", "b", "c", "d", "e"])).toEqual(["Run 2 km", "Run 5 km", "a", "b", "c", "d"])
  })
  it("anything that is not a list is no milestones", () => {
    expect(cleanMilestones("Run 5 km")).toEqual([])
    expect(cleanMilestones(null)).toEqual([])
  })
})

describe("fallbackMilestones", () => {
  it("drafts three from the goal and what done looks like", () => {
    const m = fallbackMilestones("Get fit", "Run 5 km without stopping.")
    expect(m).toHaveLength(3)
    expect(m[0]).toBe("First steps done")
    expect(m[1]).toBe("Halfway to: run 5 km without stopping")
    expect(m[2]).toBe("Run 5 km without stopping")
  })
  it("uses the goal when nothing was said about done", () => {
    expect(fallbackMilestones("Learn SQL")[2]).toBe("Learn SQL")
  })
})

describe("goalProgress", () => {
  it("says which milestone is current and its steps", () => {
    const p = goalProgress([row("a", 0, "COMPLETED", 3, 0), row("b", 1, "ACTIVE", 3, 3), row("c", 2, "PAUSED")])!
    expect(p.index).toBe(2)
    expect(p.total).toBe(3)
    expect(p.reached).toBe(1)
    expect(p.line).toBe("Milestone 2 of 3: M2 · 3 of 6 steps done")
    expect(p.milestones.map((m) => m.state)).toEqual(["REACHED", "CURRENT", "NEXT"])
    expect(p.ready).toBe(false)
  })
  it("leaves out milestones let go and says nothing about steps when there are none", () => {
    const p = goalProgress([row("a", 0, "ABANDONED"), row("b", 1, "ACTIVE"), row("c", 2, "PAUSED")])!
    expect(p.total).toBe(2)
    expect(p.line).toBe("Milestone 1 of 2: M2")
  })
  it("is ready to ask when every step of the current one is done", () => {
    expect(goalProgress([row("a", 0, "ACTIVE", 2, 0), row("b", 1, "PAUSED")])!.ready).toBe(true)
    expect(goalProgress([row("a", 0, "ACTIVE", 0, 0)])!.ready).toBe(false)
  })
  it("all reached", () => {
    const p = goalProgress([row("a", 0, "COMPLETED"), row("b", 1, "COMPLETED")])!
    expect(p.current).toBeNull()
    expect(p.line).toBe("All 2 milestones reached")
  })
  it("no milestones is no progress line", () => {
    expect(goalProgress([])).toBeNull()
  })
  it("the order decides the current one if two are open", () => {
    const p = goalProgress([row("b", 1, "ACTIVE"), row("a", 0, "PAUSED")])!
    expect(p.current!.id).toBe("a")
  })
})

describe("progress never goes down", () => {
  it("a reached milestone stays reached when a step is added to it", () => {
    const before = goalProgress([row("a", 0, "COMPLETED", 3, 0), row("b", 1, "ACTIVE", 0, 2)])!
    const after = goalProgress([row("a", 0, "COMPLETED", 3, 1), row("b", 1, "ACTIVE", 0, 2)])!
    expect(after.reached).toBe(before.reached)
    expect(after.index).toBe(before.index)
    expect(after.milestones[0].state).toBe("REACHED")
  })
  it("letting a done step go does not lower the done count", () => {
    // Done steps are counted whether archived or not; only open steps leave the total.
    const p = goalProgress([row("a", 0, "ACTIVE", 2, 0)])!
    expect(p.current!.stepsDone).toBe(2)
  })
  it("reaching opens the next one and never goes back", () => {
    const rows = [row("a", 0, "ACTIVE", 2, 0), row("b", 1, "PAUSED"), row("c", 2, "PAUSED")]
    expect(reachPlan(rows, "a")).toEqual({ reach: "a", open: "b" })
    const after = goalProgress([row("a", 0, "COMPLETED", 2, 0), row("b", 1, "ACTIVE"), row("c", 2, "PAUSED")])!
    expect(after.reached).toBeGreaterThan(goalProgress(rows)!.reached)
    expect(after.index).toBe(2)
  })
})

describe("reachPlan", () => {
  it("only the current milestone can be reached", () => {
    const rows = [row("a", 0, "COMPLETED"), row("b", 1, "ACTIVE"), row("c", 2, "PAUSED")]
    expect(reachPlan(rows, "a")).toBeNull()
    expect(reachPlan(rows, "c")).toBeNull()
    expect(reachPlan(rows, "b")).toEqual({ reach: "b", open: "c" })
  })
  it("the last one opens nothing", () => {
    expect(reachPlan([row("a", 0, "COMPLETED"), row("b", 1, "ACTIVE")], "b")).toEqual({ reach: "b", open: null })
  })
})

describe("letGoPlan", () => {
  it("letting the current one go opens the next", () => {
    expect(letGoPlan([row("a", 0, "ACTIVE"), row("b", 1, "PAUSED")], "a")).toEqual({ reach: "a", open: "b" })
  })
  it("a later one goes without opening anything; a reached one can't be let go", () => {
    const rows = [row("a", 0, "COMPLETED"), row("b", 1, "ACTIVE"), row("c", 2, "PAUSED")]
    expect(letGoPlan(rows, "c")).toEqual({ reach: "c", open: null })
    expect(letGoPlan(rows, "a")).toBeNull()
  })
})

describe("stepOffered", () => {
  it("offers steps of ordinary goals and of the current milestone only", () => {
    expect(stepOffered(null)).toBe(true)
    expect(stepOffered({ parentId: null, status: "PARKED" })).toBe(true)
    expect(stepOffered({ parentId: "g", status: "ACTIVE" })).toBe(true)
    expect(stepOffered({ parentId: "g", status: "PAUSED" })).toBe(false)
    expect(stepOffered({ parentId: "g", status: "COMPLETED" })).toBe(false)
  })
})
