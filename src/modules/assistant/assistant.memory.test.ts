import { describe, expect, it } from "vitest"
import { rankMemories } from "./assistant.memory.js"

const m = (content: string, importance: number, daysAgo: number) => ({
  content,
  importance,
  createdAt: new Date(Date.UTC(2026, 9, 5) - daysAgo * 86_400_000),
})

describe("rankMemories", () => {
  const now = new Date(Date.UTC(2026, 9, 5))
  it("puts memories that match the message first", () => {
    const ranked = rankMemories(
      [m("Likes guitar on weekends", 2, 1), m("Preparing for SDE-2 interviews in DSA", 2, 30)],
      "help me plan my DSA prep",
      now,
    )
    expect(ranked[0]!.content).toContain("DSA")
  })
  it("prefers core memories when nothing matches", () => {
    const ranked = rankMemories([m("Minor detail", 1, 0), m("Wants a better job by March", 3, 40)], "hello", now)
    expect(ranked[0]!.content).toContain("better job")
  })
  it("lifts a memory that means the same thing even with no shared words", () => {
    const tea = { id: "tea", ...m("Likes ginger tea in the evening", 2, 30) }
    const sleep = { id: "sleep", ...m("Tries to sleep by 11pm", 2, 30) }
    const without = rankMemories([sleep, tea], "what should I drink tonight", now, 1)
    expect(without[0]!.id).toBe("sleep")
    const similar = new Map([["tea", 0.64], ["sleep", 0.56]])
    expect(rankMemories([sleep, tea], "what should I drink tonight", now, 1, similar)[0]!.id).toBe("tea")
  })
  it("ignores similarity for memories that have none", () => {
    const a = { id: "a", ...m("Alpha", 3, 0) }
    const b = { id: "b", ...m("Beta", 2, 0) }
    expect(rankMemories([b, a], "x", now, 2, new Map([["b", 0.5]]))[0]!.id).toBe("a")
  })
  it("caps how many are recalled", () => {
    const many = Array.from({ length: 50 }, (_, i) => m(`fact ${i}`, 2, i))
    expect(rankMemories(many, "x", now, 25)).toHaveLength(25)
  })
})
