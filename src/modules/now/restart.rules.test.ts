import { describe, it, expect } from "vitest"
import { restartLevel, reasonInsight, recordLine, lightMinutes } from "./restart.rules.js"

describe("restartLevel", () => {
  it("scales with the gap", () => {
    expect(restartLevel(1)).toBe("NONE")
    expect(restartLevel(3)).toBe("SHORT")
    expect(restartLevel(9)).toBe("WEEK")
    expect(restartLevel(21)).toBe("LONG")
    expect(restartLevel(120)).toBe("VERY_LONG")
  })
})

describe("reasonInsight", () => {
  const at = (reason: string, hour: number) => ({ reason, hour })

  it("evenings kept failing because of tiredness → suggest mornings", () => {
    const r = reasonInsight([at("tired · tomorrow", 20), at("tired", 21), at("tired", 19), at("tired", 8), at("no time", 20)])
    expect(r).toMatchObject({ reason: "tired", count: 4, suggestBlock: "MORNING" })
    expect(r!.line).toMatch(/evenings kept failing/)
  })

  it("names the most common reason with its own fix", () => {
    const r = reasonInsight([at("forgot", 10), at("forgot", 14), at("forgot · tomorrow", 9), at("tired", 20)])
    expect(r).toMatchObject({ reason: "forgot", count: 3, suggestBlock: null })
    expect(r!.line).toMatch(/Reminders/)
  })

  it("says nothing below 3 times, or for reasons nobody chose", () => {
    expect(reasonInsight([at("tired", 20), at("tired", 21)])).toBeNull()
    expect(reasonInsight([at("not now", 20), at("not now", 21), at("tomorrow", 22)])).toBeNull()
    expect(reasonInsight([])).toBeNull()
  })
})

describe("recordLine and lightMinutes", () => {
  it("shows the honest record, never a broken streak", () => {
    expect(recordLine(23, 14)).toBe("Your record stays: 14 workouts and 23 things done so far. Nothing was lost.")
    expect(recordLine(1, 0)).toBe("Your record stays: 1 thing done so far. Nothing was lost.")
    expect(recordLine(0, 0)).toBeNull()
  })

  it("halves sessions, never under 10 minutes and never bigger", () => {
    expect(lightMinutes(40)).toBe(20)
    expect(lightMinutes(30)).toBe(15)
    expect(lightMinutes(15)).toBe(10)
    expect(lightMinutes(8)).toBe(8)
  })
})
