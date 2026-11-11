import { describe, expect, it } from "vitest"
import { benchOf, compareBench, percentile, type BenchRow } from "./bench.js"

const spend = (tokensIn: number, tokensOut: number, inr: number) => ({ calls: 1, failedCalls: 0, tokensIn, tokensOut, inr, unpricedCalls: 0, features: ["Assistant chat"] })

describe("the cost bench", () => {
  it("percentiles", () => {
    expect(percentile([], 50)).toBe(0)
    expect(percentile([300, 100, 200], 50)).toBe(200)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
  })

  it("adds up spend per message and skips pending scenarios", () => {
    const rows: BenchRow[] = [
      { id: "A", name: "a", result: "pass", replyMs: [1000, 2000], spend: spend(8000, 400, 0.6) },
      { id: "B", name: "b", result: "fail", replyMs: [3000], spend: spend(1000, 200, 0.1) },
      { id: "C", name: "c", result: "pending" },
    ]
    const b = benchOf(rows)
    expect(b).toMatchObject({ scenarios: 2, passed: 1, messages: 3, aiCalls: 2, tokensPerMessage: 3200, replyP50Ms: 2000 })
    expect(b.inrPerMessage).toBeCloseTo(0.7 / 3)
  })

  it("names scenarios that used to pass and now do not", () => {
    const before = benchOf([{ id: "A", name: "a", result: "pass", replyMs: [1000], spend: spend(9000, 400, 0.4) }])
    const afterRows: BenchRow[] = [{ id: "A", name: "a", result: "fail", replyMs: [500], spend: spend(3000, 200, 0.1) }]
    const text = compareBench(before, benchOf(afterRows), [{ id: "A", name: "a", result: "pass" }], afterRows)
    expect(text).toContain("newly failing: A")
    expect(text).toContain("tokens per message 9400 -> 3200 (-66%)")
    expect(text).toContain("(-75%)")
  })
})
