import { describe, it, expect } from "vitest"
import { placesOf, checkPlaceChange, validatePick, tiersForPick, seasonWeek, seasonWeeks, seasonOver, seasonLine, defaultEnd, reviewLines, parkedWhy, nextSeasonPick, extendedEnd, type AreaLite } from "./season.rules.js"

const now = new Date("2026-11-12T10:00:00Z")
const day = 86_400_000
const area = (id: string, tier: AreaLite["tier"], over: Partial<AreaLite> = {}): AreaLite => ({ id, name: id, tier, laterUntil: null, order: 0, ...over })

describe("placesOf", () => {
  it("puts each area in its place, and a parked area whose date passed in the background", () => {
    const p = placesOf(
      [area("career", "MAIN"), area("fitness", "MAIN"), area("english", "SECONDARY"), area("money", "MAINTAIN"), area("music", "LATER", { laterUntil: new Date(now.getTime() + 30 * day) }), area("old", "LATER", { laterUntil: new Date(now.getTime() - day) })],
      now,
    )
    expect(p.focus.map((a) => a.id)).toEqual(["career", "fitness"])
    expect(p.keepGoing.map((a) => a.id)).toEqual(["english"])
    expect(p.background.map((a) => a.id)).toEqual(["money", "old"])
    expect(p.parked.map((a) => a.id)).toEqual(["music"])
  })
})

describe("checkPlaceChange", () => {
  const areas = [area("career", "MAIN"), area("fitness", "MAIN"), area("english", "SECONDARY")]

  it("refuses a third focus and names the two that are there", () => {
    const r = checkPlaceChange(areas, "english", "MAIN", now)
    expect(r).toEqual({ ok: false, full: "MAIN", current: [{ id: "career", name: "career" }, { id: "fitness", name: "fitness" }] })
  })

  it("allows it when one of them is swapped out", () => {
    expect(checkPlaceChange(areas, "english", "MAIN", now, "fitness")).toEqual({ ok: true })
  })

  it("allows re-saving an area that is already in focus", () => {
    expect(checkPlaceChange(areas, "career", "MAIN", now)).toEqual({ ok: true })
  })

  it("never limits the background or parking", () => {
    expect(checkPlaceChange(areas, "career", "LATER", now)).toEqual({ ok: true })
  })

  it("does not count a parked area whose date passed as focus", () => {
    const withOld = [area("a", "MAIN"), area("b", "LATER", { laterUntil: new Date(now.getTime() - day) }), area("c", "MAINTAIN")]
    expect(checkPlaceChange(withOld, "c", "MAIN", now)).toEqual({ ok: true })
  })
})

describe("validatePick and tiersForPick", () => {
  it("enforces the caps and one place per area", () => {
    expect(validatePick({ focusIds: ["a", "b", "c"], keepGoingIds: [], parked: [] })).toMatch(/At most 2/)
    expect(validatePick({ focusIds: ["a"], keepGoingIds: ["b", "c", "d", "e"], parked: [] })).toMatch(/At most 3/)
    expect(validatePick({ focusIds: ["a"], keepGoingIds: ["a"], parked: [] })).toMatch(/one place/)
    expect(validatePick({ focusIds: ["a", "b"], keepGoingIds: ["c"], parked: [{ areaId: "d" }] })).toBeNull()
  })

  it("moves an old focus out of focus instead of leaving three", () => {
    const until = new Date(now.getTime() + 60 * day)
    const t = tiersForPick([area("old", "MAIN"), area("a", "MAINTAIN"), area("b", "MAINTAIN"), area("c", "LATER", { laterUntil: until })], {
      focusIds: ["a", "b"],
      keepGoingIds: [],
      parked: [],
    })
    expect(t.get("old")).toEqual({ tier: "MAINTAIN", laterUntil: null })
    expect(t.get("a")?.tier).toBe("MAIN")
    expect(t.get("c")).toEqual({ tier: "LATER", laterUntil: until })
  })
})

describe("weeks", () => {
  const start = new Date("2026-11-16T00:00:00Z")
  it("counts week 1 from the start and defaults to 10 weeks", () => {
    expect(seasonWeek(start, new Date(start.getTime() + 3 * day))).toBe(1)
    expect(seasonWeek(start, new Date(start.getTime() + 8 * day))).toBe(2)
    expect(seasonWeek(start, new Date(start.getTime() - day))).toBe(1)
    expect(seasonWeeks(start, null)).toBe(10)
    expect(seasonWeeks(start, defaultEnd(start))).toBe(10)
  })

  it("ends on its date", () => {
    expect(seasonOver(null, now)).toBe(false)
    expect(seasonOver(new Date(now.getTime() - 1), now)).toBe(true)
  })

  it("writes the line for Now", () => {
    expect(seasonLine("Switch & Shape", 1, 2, 10)).toBe("Switch & Shape · week 2 of 10")
    expect(seasonLine(null, 3, 12, 10)).toBe("Season 3 · week 10 of 10")
  })
})

describe("season review", () => {
  it("says the totals plainly, with dropped counted as progress", () => {
    expect(reviewLines({ done: 23, dropped: 4, weight: { from: 83, to: 80.5, unit: "kg" } })).toEqual([
      "23 things done this season.",
      "4 things dropped on purpose. That counts too.",
      "Weight 83 kg → 80.5 kg: 2.5 down.",
    ])
  })

  it("names a quiet season without guilt, and a weight rise without alarm", () => {
    const lines = reviewLines({ done: 0, dropped: 0, weight: { from: 80, to: 81, unit: "kg" } })
    expect(lines[0]).toBe("A quiet season. That happens. The next one can start smaller.")
    expect(lines[1]).toBe("Weight 80 kg → 81 kg. The next season can change the plan.")
    expect(lines.join(" ")).not.toMatch(/fail|behind|missed|only/i)
  })

  it("explains a parked area by what is waiting in it", () => {
    expect(parkedWhy(7)).toBe("7 things waiting")
    expect(parkedWhy(1)).toBe("1 thing waiting")
    expect(parkedWhy(0)).toBe("Nothing saved yet")
  })

  it("keeps a focus with a running plan, moves the other focus to Keep going, and leaves a slot free", () => {
    const places = placesOf([area("career", "MAIN"), area("fitness", "MAIN"), area("english", "SECONDARY"), area("calm", "SECONDARY"), area("money", "SECONDARY"), area("music", "LATER")], now)
    expect(nextSeasonPick(places, new Set(["fitness"]))).toEqual({ focusIds: ["fitness"], keepGoingIds: ["career", "english", "calm"] })
    expect(nextSeasonPick(places, new Set()).focusIds).toEqual([])
  })

  it("carries a season on from the later of today and its old end", () => {
    const past = new Date(now.getTime() - 3 * day)
    const future = new Date(now.getTime() + 3 * day)
    expect(extendedEnd(past, now, 4).getTime()).toBe(now.getTime() + 28 * day)
    expect(extendedEnd(future, now, 2).getTime()).toBe(future.getTime() + 14 * day)
  })
})
