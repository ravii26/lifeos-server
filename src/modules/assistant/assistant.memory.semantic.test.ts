import { describe, expect, it } from "vitest"
import { semanticBonus, similarities } from "./assistant.memory.semantic.js"

describe("semanticBonus", () => {
  it("gives nothing to unrelated text and more to closer text", () => {
    expect(semanticBonus(0.5)).toBe(0)
    expect(semanticBonus(0.55)).toBe(0)
    expect(semanticBonus(0.73)).toBeGreaterThan(semanticBonus(0.64))
    expect(semanticBonus(0.64)).toBeGreaterThan(0)
  })
})

describe("similarities", () => {
  it("scores memories that have a vector of the same size and skips the rest", () => {
    const out = similarities(
      [
        { id: "same", embedding: [1, 0] },
        { id: "other", embedding: [0, 1] },
        { id: "empty", embedding: [] },
        { id: "old", embedding: [1, 0, 0] },
      ],
      [1, 0],
    )
    expect(out.get("same")).toBeCloseTo(1)
    expect(out.get("other")).toBeCloseTo(0)
    expect(out.has("empty")).toBe(false)
    expect(out.has("old")).toBe(false)
  })
})
