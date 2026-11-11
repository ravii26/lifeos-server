import { describe, expect, it } from "vitest"
import { SYSTEM_PROMPT } from "./assistant.chat.js"
import { assemblePrompt, EXTRA_ACTIONS, extrasFor, type Extra } from "./assistant.prompt.js"

const none = new Set<Extra>()
const every = new Set<Extra>(["GOALS", "WEEK", "MODE", "SCHEDULE", "NUDGE", "PATTERNS"])
const typesIn = (text: string) => [...text.matchAll(/^- \{"type":"([A-Z_]+)"/gm)].map((m) => m[1]!).sort()
const quiet = { hasProjects: false, hasPatterns: false }

describe("the instructions each message gets", () => {
  it("every optional action really exists in the instructions", () => {
    const all = typesIn(SYSTEM_PROMPT)
    for (const t of Object.values(EXTRA_ACTIONS).flat()) expect(all, t).toContain(t)
  })

  it("with everything needed, nothing is lost", () => {
    expect(typesIn(assemblePrompt(SYSTEM_PROMPT, every))).toEqual(typesIn(SYSTEM_PROMPT))
    expect(assemblePrompt(SYSTEM_PROMPT, every)).toContain("Patterns (")
  })

  it("everyday actions are always there; rare ones only when needed", () => {
    const lean = typesIn(assemblePrompt(SYSTEM_PROMPT, none))
    for (const t of ["ADD_TASK", "COMPLETE_TASK", "SET_REMINDER", "ADD_HABIT", "ADD_NOTE", "COMFORT", "SEARCH", "WHAT_NOW"]) expect(lean, t).toContain(t)
    for (const t of Object.values(EXTRA_ACTIONS).flat()) expect(lean, t).not.toContain(t)
    expect(assemblePrompt(SYSTEM_PROMPT, none)).not.toContain("Patterns (")
  })

  it("the start of the instructions is identical whatever the message, so the cache keeps hitting", () => {
    const lean = assemblePrompt(SYSTEM_PROMPT, none)
    const withGoals = assemblePrompt(SYSTEM_PROMPT, new Set<Extra>(["GOALS", "PATTERNS"]))
    expect(withGoals.startsWith(lean)).toBe(true)
  })

  it("is meaningfully shorter for an everyday message", () => {
    expect(assemblePrompt(SYSTEM_PROMPT, none).length).toBeLessThan(SYSTEM_PROMPT.length * 0.8)
  })
})

describe("deciding what a message could need", () => {
  it("everyday messages need nothing extra", () => {
    for (const m of ["remind me to call mummy at 7", "add milk to my shopping list", "done with the blood test", "I feel low today"]) {
      expect([...extrasFor(m, quiet)], m).toEqual([])
    }
  })

  it("goals, progress and decisions bring the goal actions", () => {
    for (const m of ["I want to switch jobs in 6 months", "solved 23 problems today", "where do I stand on my exam prep", "pause my investing goal", "mujhe guitar seekhna hai"]) {
      expect(extrasFor(m, quiet).has("GOALS"), m).toBe(true)
    }
  })

  it("a number with active goals might be progress", () => {
    expect(extrasFor("did 40 today", { hasProjects: true, hasPatterns: false }).has("GOALS")).toBe(true)
  })

  it("the rest come when their words do", () => {
    expect(extrasFor("how was my week", quiet).has("WEEK")).toBe(true)
    expect(extrasFor("I'm sick today", quiet).has("MODE")).toBe(true)
    expect(extrasFor("bukhar hai aaj", quiet).has("MODE")).toBe(true)
    expect(extrasFor("I work 10 to 8 on weekdays", quiet).has("SCHEDULE")).toBe(true)
    expect(extrasFor("nudge me every night at 9:30", quiet).has("NUDGE")).toBe(true)
    expect(extrasFor("should I take the new offer?", quiet).has("PATTERNS")).toBe(true)
    expect(extrasFor("hi", { hasProjects: false, hasPatterns: true }).has("PATTERNS")).toBe(true)
  })

  it("a long message gets everything", () => {
    const long = "I want to drink warm water every morning, and here are my breakfasts: poha, oats, eggs; prep the night before, and also call the bank tomorrow about the card and pay the electricity bill"
    expect(long.length).toBeGreaterThan(160)
    expect(extrasFor(long, quiet).size).toBe(5)
  })
})
