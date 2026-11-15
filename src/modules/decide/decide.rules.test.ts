import { describe, expect, it } from "vitest"
import { checkInDays, checkInTitle, cleanDecision, fallbackDecision, isSerious } from "./decide.rules.js"

describe("help me decide", () => {
  it("keeps a clean answer from the model", () => {
    const d = cleanDecision({ pick: "B", why: "It fits your evenings.", firstStep: "Sign up for one class.", checkInDays: 14 }, "Gym", "Swimming", [])
    expect(d).toEqual({ pick: "B", why: "It fits your evenings.", firstStep: "Sign up for one class.", checkInDays: 14 })
  })
  it("anything missing or odd becomes the plain method", () => {
    expect(cleanDecision({ pick: "C", why: "x", firstStep: "y" }, "a", "b", []).pick).toBe("EITHER")
    expect(cleanDecision(null, "a", "b", ["FEAR"]).why).toContain("fear")
    expect(cleanDecision({ pick: "A", why: "", firstStep: "y" }, "a", "b", [])).toEqual(fallbackDecision([]))
  })
  it("never picks on health, law or large money", () => {
    expect(isSerious("Take the loan", "Wait a year")).toBe(true)
    const d = cleanDecision({ pick: "A", why: "Do it.", firstStep: "Sign today." }, "Take the loan", "Wait a year", [])
    expect(d.pick).toBe("EITHER")
    expect(d.why).toContain("qualified")
    // Even when no AI answered.
    expect(cleanDecision(null, "Start the new medication", "Keep the old one", []).why).toContain("qualified")
  })
  it("check-in is between 3 days and a month", () => {
    expect(checkInDays(1)).toBe(3)
    expect(checkInDays(90)).toBe(30)
    expect(checkInDays("soon")).toBe(7)
  })
  it("the check-in reads plainly", () => {
    expect(checkInTitle(" Join the evening class ")).toBe('Check in: how is "Join the evening class" going?')
  })
})
