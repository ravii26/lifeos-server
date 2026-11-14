import { describe, expect, it } from "vitest"
import { diffEdit, moveTargetKey, nextMondayKey } from "./step.rules.js"

describe("moving a step", () => {
  // 2026-11-18 is a Wednesday.
  it("tomorrow is the next day", () => {
    expect(moveTargetKey("TOMORROW", "2026-11-18")).toBe("2026-11-19")
    expect(moveTargetKey("TOMORROW", "2026-12-31")).toBe("2027-01-01")
  })
  it("the weekend is the coming Saturday; on a Saturday, the next one", () => {
    expect(moveTargetKey("WEEKEND", "2026-11-18")).toBe("2026-11-21")
    expect(moveTargetKey("WEEKEND", "2026-11-21")).toBe("2026-11-28")
  })
  it("next week is the coming Monday; on a Monday, the one after", () => {
    expect(moveTargetKey("NEXT_WEEK", "2026-11-18")).toBe("2026-11-23")
    expect(nextMondayKey("2026-11-22")).toBe("2026-11-23") // Sunday
    expect(nextMondayKey("2026-11-23")).toBe("2026-11-30") // Monday
  })
})

describe("editing a step", () => {
  const now = { title: "Write the intro", sizeMinutes: 30, energy: null, minimumVersion: null }

  it("keeps only what changes, and what it was, for Undo", () => {
    const r = diffEdit(now, { title: "Write the intro", sizeMinutes: 20, energy: "HIGH" })
    expect(r.data).toEqual({ sizeMinutes: 20, energy: "HIGH" })
    expect(r.prev).toEqual({ sizeMinutes: 30, energy: null })
  })
  it("a smaller version can be set and cleared; blank means none", () => {
    expect(diffEdit(now, { minimumVersion: "  Write one line " }).data).toEqual({ minimumVersion: "Write one line" })
    expect(diffEdit({ ...now, minimumVersion: "x" }, { minimumVersion: "   " }).data).toEqual({ minimumVersion: null })
  })
  it("a name is never emptied", () => {
    expect(diffEdit(now, { title: "  " }).data).toEqual({})
  })
  it("nothing changed, nothing to save", () => {
    expect(diffEdit(now, {}).data).toEqual({})
  })
})
