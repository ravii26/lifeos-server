import { describe, expect, it } from "vitest"
import { habitBlock, timesAWeek, withoutPrepClaims } from "./assistant.chat.js"

describe("habits made by chat", () => {
  it("never puts a habit inside office hours", () => {
    expect(habitBlock("OFFICE", "After office")).toBe("EVENING")
    expect(habitBlock("OFFICE", "before work")).toBe("MORNING")
    expect(habitBlock("OFFICE", null)).toBe("")
    expect(habitBlock("EVENING", "After office")).toBe("EVENING")
  })
  it("reads 'N times a week' next to the habit's own name", () => {
    const said = "Gym 4 times a week after office, and a 20 minute walk every day"
    expect(timesAWeek(said, "Gym")).toBe(4)
    expect(timesAWeek(said, "Daily walk")).toBeNull()
    expect(timesAWeek(said, "Walk")).toBeNull()
    expect(timesAWeek("yoga 3x a week", "Yoga")).toBe(3)
    expect(timesAWeek("gym every day", "Gym")).toBeNull()
  })
  it("drops the reply's claim about a prep step that wasn't made", () => {
    expect(withoutPrepClaims("Added reading 20 pages before sleep. I also set a 9:30 PM reminder to prep your book the night before.")).toBe("Added reading 20 pages before sleep.")
    expect(withoutPrepClaims("I'll prepare it.")).toBe("")
  })
})
