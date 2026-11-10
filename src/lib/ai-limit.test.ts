import { describe, expect, it } from "vitest"
import { dayStartFor, overLimit } from "./ai-limit.js"

describe("the daily AI cap", () => {
  it("stops at the cap, and 0 means no cap", () => {
    expect(overLimit(99, 100)).toBe(false)
    expect(overLimit(100, 100)).toBe(true)
    expect(overLimit(5000, 0)).toBe(false)
  })
  it("starts the day at midnight where the person lives", () => {
    // 11 Nov, 01:00 in India is still 10 Nov in UTC.
    const now = new Date("2026-11-10T19:30:00.000Z")
    expect(dayStartFor("Asia/Kolkata", now).toISOString()).toBe("2026-11-10T18:30:00.000Z")
    expect(dayStartFor("UTC", now).toISOString()).toBe("2026-11-10T00:00:00.000Z")
  })
})
