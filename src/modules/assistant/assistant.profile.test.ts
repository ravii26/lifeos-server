import { describe, expect, it } from "vitest"
import { cleanProfile, PROFILE_MAX_CHARS, profileInput, profileIsStale } from "./assistant.profile.js"

describe("the daily profile", () => {
  it("is rewritten once per day, from midnight where the person lives", () => {
    const now = new Date("2026-11-11T04:00:00.000Z") // 09:30 in India
    expect(profileIsStale(null, "Asia/Kolkata", now)).toBe(true)
    expect(profileIsStale(new Date("2026-11-10T20:00:00.000Z"), "Asia/Kolkata", now)).toBe(false) // 01:30 today in India
    expect(profileIsStale(new Date("2026-11-10T18:00:00.000Z"), "Asia/Kolkata", now)).toBe(true) // 23:30 yesterday
  })

  it("is written from the most important and newest facts first", () => {
    const at = (d: string) => new Date(`${d}T10:00:00.000Z`)
    const text = profileInput({
      memories: [
        { content: "Likes tea", kind: "PREFERENCE", importance: 1, createdAt: at("2026-11-01") },
        { content: "Preparing for SDE interviews", kind: "GOAL", importance: 3, createdAt: at("2026-10-01") },
        { content: "Works 10 to 7", kind: "FACT", importance: 3, createdAt: at("2026-11-05") },
      ],
      goals: ["Crack DSA by March"],
      areas: ["Career", "Health"],
      habits: [],
    })
    expect(text.indexOf("Works 10 to 7")).toBeLessThan(text.indexOf("Preparing for SDE"))
    expect(text.indexOf("Preparing for SDE")).toBeLessThan(text.indexOf("Likes tea"))
    expect(text).toContain("Goals now: Crack DSA by March")
    expect(text).not.toContain("Habits:")
  })

  it("keeps only a usable reply", () => {
    expect(cleanProfile('{"profile": "Ravi is a software engineer in Pune preparing for interviews while working long days."}')).toMatch(/^Ravi is/)
    expect(cleanProfile("Ravi is a software engineer in Pune preparing for interviews.")).toMatch(/^Ravi/)
    expect(cleanProfile('{"profile": "Too short"}')).toBeNull()
    expect(cleanProfile('{"profile": 42}')).toBeNull()
    expect(cleanProfile(null)).toBeNull()
    const long = cleanProfile(JSON.stringify({ profile: "word ".repeat(400) }))!
    expect(long.length).toBeLessThanOrEqual(PROFILE_MAX_CHARS)
    expect(long.endsWith("…")).toBe(true)
  })
})
