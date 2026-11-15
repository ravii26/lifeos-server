import { describe, expect, it } from "vitest"
import { cleanNumber, lastPoints } from "./number.rules.js"

describe("readings for the trend line", () => {
  it("the most recent ones, oldest first", () => {
    const d = (n: number) => new Date(Date.UTC(2026, 10, n))
    const pts = lastPoints([{ value: 3, at: d(3) }, { value: 1, at: d(1) }, { value: 2, at: d(2) }], 2)
    expect(pts.map((p) => p.value)).toEqual([2, 3])
  })
  it("none yet, nothing to draw", () => {
    expect(lastPoints([])).toEqual([])
  })
})

describe("a new tracked number", () => {
  it("keeps a clean name and unit", () => {
    expect(cleanNumber({ name: "  Weight ", unit: "kg", start: "82", target: 75 })).toEqual({ name: "Weight", unit: "kg", start: 82, target: 75 })
  })
  it("says plainly what is missing", () => {
    expect(cleanNumber({ name: "", start: 1, target: 2 })).toMatch(/name/)
    expect(cleanNumber({ name: "Savings", start: "a lot", target: 2 })).toMatch(/now/)
    expect(cleanNumber({ name: "Savings", start: 5, target: 5 })).toMatch(/already/)
  })
})
