import { describe, expect, it } from "vitest"
import { freeTime, type FreeInput } from "./free.rules.js"
import type { NowCandidate } from "./now.rules.js"

// Sample areas for someone with a job, a health goal and two curiosities.
// Nothing here is specific to one person.
const c = (over: Partial<NowCandidate> & { sourceId: string; title: string }): NowCandidate => ({
  sourceType: "TASK",
  block: null,
  sizeMinutes: 30,
  minimum: null,
  tier: "MAINTAIN",
  dueKey: null,
  order: 0,
  areaName: null,
  goalTitle: null,
  goalWhy: null,
  areaIdleDays: 1,
  ...over,
})

const work = c({ sourceId: "w1", title: "Practice two problems", tier: "MAIN", areaName: "Work", sizeMinutes: 45, minimum: "Read one problem", areaIdleDays: 1 })
const health = c({ sourceId: "h1", title: "Strength, 3 rounds", sourceType: "HABIT", tier: "MAIN", areaName: "Health", sizeMinutes: 25, areaIdleDays: 0 })
const family = c({ sourceId: "f1", title: "Call home", tier: "SECONDARY", areaName: "Family", sizeMinutes: 20, areaIdleDays: 8 })
const writing = c({ sourceId: "x1", title: "Write the next post", tier: "MAINTAIN", areaName: "Writing", sizeMinutes: 40, areaIdleDays: 9 })
const music = c({ sourceId: "m1", title: "Three chords on the keyboard", tier: "MAINTAIN", areaName: "Music", sizeMinutes: 60, areaIdleDays: 21 })
const all = [work, health, family, writing, music]

const ask = (over: Partial<FreeInput> = {}) =>
  freeTime({ minutes: 45, energy: "OKAY", place: "HOME", todayKey: "2026-11-18", weekday: 3, mode: "NORMAL", candidates: all, ...over })

describe("freeTime", () => {
  it("a main area not touched today comes first on a weekday", () => {
    const r = ask()
    expect(r.kind).toBe("PICK")
    expect(r.picks[0]!.areaName).toBe("Work")
    expect(r.picks[0]!.lane).toBe("PUSH")
  })

  it("a long free block on a weekend goes to the area left alone longest", () => {
    const r = ask({ minutes: 120, weekday: 0, candidates: [{ ...work, areaIdleDays: 0 }, health, family, writing, music] })
    expect(r.picks[0]!.areaName).toBe("Music")
    expect(r.picks[0]!.why).toContain("3 weeks")
    expect(r.picks[0]!.why).toContain("real block of time")
  })

  it("a main area that already had time today is offered only as extra", () => {
    const r = ask({ minutes: 30, candidates: [health, family] })
    expect(r.picks[0]!.areaName).toBe("Family")
    const extra = r.picks.find((p) => p.areaName === "Health")!
    expect(extra.why).toContain("already had time today")
  })

  it("an area you keep going that has been quiet beats one you only explore, in a short window", () => {
    const r = ask({ minutes: 20, candidates: [family, c({ sourceId: "x2", title: "Pick five topics", areaName: "Writing", sizeMinutes: 15, areaIdleDays: 2 })] })
    expect(r.picks[0]!.areaName).toBe("Family")
    expect(r.picks[0]!.why).toBe("Family hasn't had any time for 8 days.")
  })

  it("something due today or tomorrow wins over everything", () => {
    const bill = c({ sourceId: "b1", title: "Pay the electricity bill", areaName: "Money", tier: "SECONDARY", sizeMinutes: 10, dueKey: "2026-11-19" })
    const r = ask({ candidates: [...all, bill] })
    expect(r.picks[0]!.sourceId).toBe("b1")
    expect(r.picks[0]!.lane).toBe("DATED")
    expect(r.picks[0]!.why).toContain("due tomorrow")
  })

  it("gives one pick per area, so Something else walks through the other areas", () => {
    const second = c({ sourceId: "w2", title: "Shortlist five companies", tier: "MAIN", areaName: "Work", sizeMinutes: 30, order: 1 })
    const r = ask({ minutes: 120, candidates: [...all, second] })
    const areas = r.picks.map((p) => p.areaName)
    expect(new Set(areas).size).toBe(areas.length)
    expect(areas).toEqual(expect.arrayContaining(["Work", "Health", "Family", "Writing", "Music"]))
  })

  it("away from home, only things that need no desk are offered", () => {
    const desk = c({ sourceId: "d1", title: "Record a video", areaName: "Writing", block: "EVENING", sizeMinutes: 20 })
    const onTheWay = c({ sourceId: "d2", title: "Read one solution", areaName: "Work", tier: "MAIN", block: "COMMUTE", sizeMinutes: 20 })
    const gym = c({ sourceId: "d3", title: "Gym", sourceType: "HABIT", areaName: "Health", tier: "MAIN", block: "GYM", sizeMinutes: 20 })
    const r = ask({ minutes: 30, place: "OUT", candidates: [desk, onTheWay, gym] })
    expect(r.picks.map((p) => p.sourceId)).toEqual(["d2"])
  })

  it("low energy offers the smallest version of anything long", () => {
    const r = ask({ energy: "LOW", candidates: [work] })
    expect(r.picks[0]!.smaller).toBe(true)
    expect(r.picks[0]!.minutes).toBeLessThanOrEqual(15)
    expect(r.message).toContain("Read one problem")
  })

  it("low energy leaves short things as they are", () => {
    const short = c({ sourceId: "s1", title: "Water the plants", areaName: "Home", sizeMinutes: 10 })
    const r = ask({ energy: "LOW", candidates: [short] })
    expect(r.picks[0]!.smaller).toBe(false)
    expect(r.picks[0]!.minutes).toBe(10)
  })

  it("leaves out resting areas, counts, office work and prep steps", () => {
    const r = ask({
      minutes: 120,
      candidates: [
        c({ sourceId: "r1", title: "Edit the short film", areaName: "Film", tier: "LATER" }),
        c({ sourceId: "r2", title: "Water", sourceType: "HABIT", areaName: "Health", counted: true }),
        c({ sourceId: "r3", title: "Quarterly report", areaName: "Job", block: "OFFICE" }),
        c({ sourceId: "r4", title: "Prep gym bag", sourceType: "HABIT", areaName: "Health" }),
      ],
    })
    expect(r.kind).toBe("REST")
    expect(r.picks).toEqual([])
  })

  it("does not offer what cannot fit, and says rest is fine", () => {
    const r = ask({ minutes: 10, candidates: [music] })
    expect(r.kind).toBe("REST")
    expect(r.message).toContain("Rest is a good use of it")
  })

  it("a thing with no area is a good use of a few minutes", () => {
    const chore = c({ sourceId: "l1", title: "Reply to the landlord", sizeMinutes: 5, areaName: null })
    const r = ask({ minutes: 15, candidates: [chore, c({ sourceId: "x3", title: "Pick five topics", areaName: "Writing", sizeMinutes: 15, areaIdleDays: 2 })] })
    expect(r.picks[0]!.sourceId).toBe("l1")
    expect(r.picks[0]!.lane).toBe("LOOSE")
  })

  it("what was put off earlier today comes last", () => {
    const r = ask({ candidates: [{ ...work, skippedToday: true }, family] })
    expect(r.picks[0]!.areaName).toBe("Family")
    expect(r.picks[1]!.areaName).toBe("Work")
  })

  it("an area nothing was ever done in is described honestly", () => {
    const fresh = c({ sourceId: "n1", title: "Sketch for ten minutes", areaName: "Drawing", sizeMinutes: 10, areaIdleDays: null })
    const r = ask({ minutes: 15, candidates: [fresh] })
    expect(r.picks[0]!.why).toBe("Drawing hasn't been touched yet.")
  })

  it("sick mode asks for nothing", () => {
    const r = ask({ mode: "SICK" })
    expect(r.kind).toBe("REST")
    expect(r.picks).toEqual([])
  })
})
