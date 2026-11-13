import { describe, it, expect } from "vitest"
import { seasonIntent, returnDate, matchAreas } from "./season.phrases.js"

describe("seasonIntent", () => {
  it("reads parking, with or without a return", () => {
    expect(seasonIntent("park money until March")).toEqual({ kind: "PARK", name: "money", when: "March" })
    expect(seasonIntent("Park my guitar for 2 months")).toEqual({ kind: "PARK", name: "guitar", when: "2 months" })
    expect(seasonIntent("park business ideas till after the switch")).toEqual({ kind: "PARK", name: "business ideas", when: "after the switch" })
    expect(seasonIntent("park filmmaking")).toEqual({ kind: "PARK", name: "filmmaking", when: null })
  })

  it("reads making something the focus, and the swap the app's button sends", () => {
    expect(seasonIntent("make English my focus")).toEqual({ kind: "FOCUS", name: "English" })
    expect(seasonIntent("make fitness my main focus")).toEqual({ kind: "FOCUS", name: "fitness" })
    expect(seasonIntent("Make English my focus instead of Career")).toEqual({ kind: "FOCUS", name: "English", instead: "Career" })
  })

  it("leaves everything else to the other handlers", () => {
    expect(seasonIntent("remind me to park the car at 6")).toBeNull()
    expect(seasonIntent("I want to focus on DSA")).toBeNull()
    expect(seasonIntent("what should I do now")).toBeNull()
  })
})

describe("returnDate", () => {
  const today = "2026-11-12"
  it("turns a month into the 1st of its next occurrence", () => {
    expect(returnDate("March", today)).toBe("2027-03-01")
    expect(returnDate("december", today)).toBe("2026-12-01")
    expect(returnDate("November", today)).toBe("2027-11-01")
  })
  it("counts weeks, months and next month", () => {
    expect(returnDate("2 months", today)).toBe("2027-01-12")
    expect(returnDate("three weeks", today)).toBe("2026-12-03")
    expect(returnDate("next month", today)).toBe("2026-12-01")
  })
  it("returns no date for words it can't place", () => {
    expect(returnDate("after the switch", today)).toBeNull()
    expect(returnDate(null, today)).toBeNull()
  })
})

describe("matchAreas", () => {
  const areas = [{ name: "Career: job switch" }, { name: "Fitness" }, { name: "Money: learning" }, { name: "Money admin" }]
  it("prefers an exact name, then a partial one, and returns all that fit", () => {
    expect(matchAreas("fitness", areas)).toEqual([{ name: "Fitness" }])
    expect(matchAreas("career", areas)).toEqual([{ name: "Career: job switch" }])
    expect(matchAreas("money", areas)).toHaveLength(2)
    expect(matchAreas("guitar", areas)).toEqual([])
  })
})
