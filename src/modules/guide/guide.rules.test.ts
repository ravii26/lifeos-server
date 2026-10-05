import { describe, expect, it } from "vitest"
import {
  effectiveTier,
  shortlist,
  missedStreak,
  DEFAULT_MINIMUM,
  type CandidateInput,
} from "./guide.rules.js"
import { heuristicPick } from "./guide.ai.js"

const base = (over: Partial<CandidateInput>): CandidateInput => ({
  sourceType: "TASK",
  sourceId: "x",
  title: "x",
  minimumVersion: null,
  areaId: "a",
  areaName: "Career",
  tier: "MAINTAIN",
  goalId: null,
  goalTitle: null,
  goalWhy: null,
  ...over,
})

describe("guide rules", () => {
  const today = "2026-10-05"

  it("ranks MAIN above SECONDARY above MAINTAIN and drops LATER", () => {
    const list = shortlist(
      [
        base({ sourceId: "m", title: "maintain", tier: "MAINTAIN" }),
        base({ sourceId: "l", title: "later", tier: "LATER", priority: "CRITICAL" }),
        base({ sourceId: "s", title: "secondary", tier: "SECONDARY" }),
        base({ sourceId: "M", title: "main", tier: "MAIN" }),
      ],
      today,
      [],
    )
    expect(list.map((c) => c.sourceId)).toEqual(["M", "s", "m"])
  })

  it("pushes a repeatedly skipped item down without removing it", () => {
    const list = shortlist(
      [base({ sourceId: "dodged", tier: "MAIN" }), base({ sourceId: "other", tier: "MAIN" })],
      today,
      [
        { dateKey: "2026-10-04", sourceId: "dodged", status: "SKIPPED" },
        { dateKey: "2026-10-03", sourceId: "dodged", status: "SKIPPED" },
      ],
    )
    expect(list.map((c) => c.sourceId)).toEqual(["other", "dodged"])
  })

  it("uses the goal's why, then the goal title, then the area", () => {
    const [a] = shortlist([base({ goalId: "g", goalTitle: "SDE-2 switch", goalWhy: "Better job by March." })], today, [])
    const [b] = shortlist([base({ goalId: "g", goalTitle: "SDE-2 switch" })], today, [])
    const [c] = shortlist([base({ tier: "MAIN" })], today, [])
    expect(a!.why).toBe("Better job by March.")
    expect(b!.why).toContain("SDE-2 switch")
    expect(c!.why).toContain("Career")
  })

  it("falls back to a default minimum", () => {
    const [a] = shortlist([base({})], today, [])
    const [b] = shortlist([base({ minimumVersion: "Read the problem" })], today, [])
    expect(a!.minimum).toBe(DEFAULT_MINIMUM)
    expect(b!.minimum).toBe("Read the problem")
  })

  it("counts consecutive missed nights, stopping at a done night or a gap", () => {
    expect(
      missedStreak(
        [
          { dateKey: "2026-10-04", sourceId: "a", status: "SKIPPED" },
          { dateKey: "2026-10-03", sourceId: "a", status: "PENDING" },
          { dateKey: "2026-10-02", sourceId: "a", status: "DONE" },
          { dateKey: "2026-10-01", sourceId: "a", status: "SKIPPED" },
        ],
        today,
      ),
    ).toBe(2)
    expect(missedStreak([{ dateKey: "2026-10-03", sourceId: "a", status: "SKIPPED" }], today)).toBe(0)
  })

  it("brings a LATER area back once its date passes", () => {
    const now = new Date("2026-10-05T12:00:00Z")
    expect(effectiveTier("LATER", new Date("2026-10-01"), now)).toBe("MAINTAIN")
    expect(effectiveTier("LATER", new Date("2026-12-01"), now)).toBe("LATER")
    expect(effectiveTier("LATER", null, now)).toBe("LATER")
  })

  it("the heuristic asks only for the minimum after missed nights", () => {
    const options = shortlist([base({ title: "Solve one sliding-window problem", minimumVersion: "Read it." })], today, [])
    const normal = heuristicPick({ options, mode: "NORMAL", misses: 0, weekday: "Monday", lastSkipReasons: [], thisYearGoal: null })
    const smaller = heuristicPick({ options, mode: "SMALLER", misses: 2, weekday: "Monday", lastSkipReasons: [], thisYearGoal: null })
    expect(normal.message).toContain("Solve one sliding-window problem")
    expect(smaller.message).toContain("missed 2 nights")
    expect(smaller.message).toContain("Read it.")
  })
})
