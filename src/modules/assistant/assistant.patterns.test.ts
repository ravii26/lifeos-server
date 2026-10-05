import { describe, expect, it } from "vitest"
import { detectPatterns, type PatternFacts } from "./assistant.patterns.js"

const base: PatternFacts = {
  savesLast14: 0,
  savesActedOn: 0,
  savesStillUndecided: 0,
  nightsAnswered: { firstWeek: 0, secondWeek: 0 },
  missedNightsInARow: 0,
  tasksCompletedLast14: 0,
  tasksAddedLast14: 0,
}

describe("detectPatterns", () => {
  it("finds nothing for a quiet, healthy fortnight", () => {
    expect(detectPatterns({ ...base, savesLast14: 3, savesActedOn: 2, tasksAddedLast14: 4, tasksCompletedLast14: 3 })).toEqual([])
  })
  it("flags consuming instead of doing, with evidence", () => {
    const [p] = detectPatterns({ ...base, savesLast14: 10, savesActedOn: 1 })
    expect(p!.id).toBe("CONSUMING_NOT_DOING")
    expect(p!.evidence).toContain("10")
  })
  it("flags a strong start that fades", () => {
    expect(detectPatterns({ ...base, nightsAnswered: { firstWeek: 6, secondWeek: 2 } })[0]!.id).toBe("STRONG_START_FADING")
  })
  it("flags tasks piling up and missed nights", () => {
    const ids = detectPatterns({ ...base, tasksAddedLast14: 12, tasksCompletedLast14: 1, missedNightsInARow: 3 }).map((p) => p.id)
    expect(ids).toEqual(["PILING_UP", "SLIPPING"])
  })
})
