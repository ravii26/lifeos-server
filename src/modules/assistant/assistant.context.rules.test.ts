import { describe, expect, it } from "vitest"
import { asksAboutMemory, memoryLimitFor, pickNotes, pickTasksForPrompt, wantsAllTasks } from "./assistant.context.rules.js"

const task = (id: string, title: string, due: string | null = null) => ({ id, title, dueDate: due ? new Date(`${due}T00:00:00.000Z`) : null })
const tasks = [
  task("a", "Book the blood test", "2026-11-11"),
  task("b", "Call Mummy", "2026-11-20"),
  task("c", "One DSA problem"),
  task("d", "Renew passport", "2026-11-12"),
  task("e", "Buy a birthday gift for Priya"),
]

describe("which to-dos go with a message", () => {
  it("shows what the message is about, then what is due by tomorrow", () => {
    const picked = pickTasksForPrompt(tasks, "remind me to call mummy on sunday", "2026-11-12", new Set())
    expect(picked.map((t) => t.id)).toEqual(["b", "a", "d"])
  })

  it("adds what the life index says it means, even with no shared words", () => {
    const picked = pickTasksForPrompt(tasks, "I want to get better at coding interviews", "2026-11-12", new Set(["c"]))
    expect(picked[0]!.id).toBe("c")
  })

  it("shows nothing unrelated and nothing undated for small talk", () => {
    expect(pickTasksForPrompt(tasks, "hi", "2026-11-10", new Set())).toEqual([])
  })

  it("asking about the list shows the whole list", () => {
    for (const m of ["what's on my list", "show all my tasks", "plan my week", "what do I have today", "my to-dos"]) {
      expect(wantsAllTasks(m), m).toBe(true)
      expect(pickTasksForPrompt(tasks, m, "2026-11-10", new Set())).toHaveLength(5)
    }
  })

  it("respects the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => task(`t${i}`, `Thing ${i}`, "2026-11-11"))
    expect(pickTasksForPrompt(many, "ok", "2026-11-12", new Set())).toHaveLength(15)
  })
})

describe("how many memories go with a message", () => {
  it("fewer normally, all of them when asked what Ally knows", () => {
    expect(memoryLimitFor("I had a long day")).toBe(12)
    for (const m of ["what do you know about me", "forget that I like tea", "what do you remember"]) {
      expect(asksAboutMemory(m), m).toBe(true)
      expect(memoryLimitFor(m)).toBe(30)
    }
  })
})

describe("which notes go with a message", () => {
  it("meaning matches first, then word matches, no repeats, within the limit", () => {
    const all = [{ id: "breakfast" }, { id: "gym" }, { id: "client" }, { id: "diet" }]
    expect(pickNotes([{ id: "gym" }, { id: "breakfast" }], all, new Set(["diet", "gym"]), 3).map((n) => n.id)).toEqual(["gym", "diet", "breakfast"])
  })
})
