import { describe, expect, it } from "vitest"
import { createdReply, duration, limitIntent, limitLine, limitStatus } from "./limits.rules.js"

describe("limitIntent: setting a limit", () => {
  it("reads time limits", () => {
    expect(limitIntent("limit Instagram to 1 hour")).toEqual({ kind: "CREATE", what: "instagram", per: "TIME", max: 60 })
    expect(limitIntent("limit reels to 45 minutes a day")).toEqual({ kind: "CREATE", what: "reels", per: "TIME", max: 45 })
    expect(limitIntent("max 1.5 h on youtube a day")).toEqual({ kind: "CREATE", what: "youtube", per: "TIME", max: 90 })
    expect(limitIntent("no more than 2 hours of instagram per day")).toEqual({ kind: "CREATE", what: "instagram", per: "TIME", max: 120 })
  })
  it("reads count limits and never-limits", () => {
    expect(limitIntent("limit chai to 2 cups a day")).toEqual({ kind: "CREATE", what: "chai", per: "COUNT", max: 2 })
    expect(limitIntent("at most 3 cups of coffee a day")).toEqual({ kind: "CREATE", what: "coffee", per: "COUNT", max: 3 })
    expect(limitIntent("no sugar")).toEqual({ kind: "CREATE", what: "sugar", per: "COUNT", max: 0 })
    expect(limitIntent("avoid junk food")).toEqual({ kind: "CREATE", what: "junk food", per: "COUNT", max: 0 })
    expect(limitIntent("quit smoking")).toEqual({ kind: "CREATE", what: "smoking", per: "COUNT", max: 0 })
  })
  it("does not turn ordinary sentences into limits", () => {
    expect(limitIntent("no thanks")).toBeNull()
    expect(limitIntent("no problem")).toBeNull()
    expect(limitIntent("no more than 3 tasks today")).toBeNull() // no "a day": left to the AI
    expect(limitIntent("max 2 hours on this report")).toBeNull()
    expect(limitIntent("stop the nudges")).toBeNull()
    expect(limitIntent("quit")).toBeNull()
  })
})

describe("limitIntent: using some and asking", () => {
  it("reads time spent", () => {
    expect(limitIntent("spent 40 min on instagram")).toEqual({ kind: "USE_TIME", minutes: 40, what: "instagram" })
    expect(limitIntent("scrolled reels for 1 hour")).toEqual({ kind: "USE_TIME", minutes: 60, what: "reels" })
    expect(limitIntent("I watched 25 minutes of youtube")).toEqual({ kind: "USE_TIME", minutes: 25, what: "youtube" })
  })
  it("reads questions about limits", () => {
    expect(limitIntent("how's my instagram limit?")).toEqual({ kind: "ASK", what: "instagram" })
    expect(limitIntent("how am I doing on my limits")).toEqual({ kind: "ASK", what: null })
    expect(limitIntent("show my limits")).toEqual({ kind: "ASK", what: null })
    expect(limitIntent("am I within my limits?")).toEqual({ kind: "ASK", what: null })
  })
})

describe("limitStatus", () => {
  const today = "2026-10-24"
  it("keeps days with nothing logged and days within the cap", () => {
    const s = limitStatus(60, [{ date: "2026-10-24", used: 40 }, { date: "2026-10-23", used: 90 }, { date: "2026-10-22", used: 60 }], "2026-10-10", today)
    expect(s).toEqual({ usedToday: 40, left: 20, over: false, keptDays: 6, counted: 7 })
  })
  it("never counts days before the limit was set", () => {
    const s = limitStatus(60, [], "2026-10-22", today)
    expect(s).toMatchObject({ counted: 3, keptDays: 3 })
  })
  it("adds up several logs in one day and is over only past the cap", () => {
    const s = limitStatus(60, [{ date: today, used: 40 }, { date: today, used: 30 }], today, today)
    expect(s).toMatchObject({ usedToday: 70, over: true, left: 0, keptDays: 0, counted: 1 })
  })
  it("treats zero as none at all", () => {
    expect(limitStatus(0, [{ date: today, used: 1 }], "2026-10-20", today)).toMatchObject({ over: true, keptDays: 4, counted: 5 })
  })
})

describe("words", () => {
  it("formats durations", () => {
    expect(duration(40)).toBe("40 min")
    expect(duration(60)).toBe("1 h")
    expect(duration(80)).toBe("1 h 20 min")
  })
  it("says it plainly, with no streak or blame", () => {
    const under = limitStatus(60, [{ date: "2026-10-24", used: 40 }], "2026-10-10", "2026-10-24")
    expect(limitLine("instagram", "TIME", 60, under)).toBe("Instagram: 40 min of 1 h today, 20 min left. Kept 7 of the last 7 days.")
    const over = limitStatus(60, [{ date: "2026-10-24", used: 80 }], "2026-10-10", "2026-10-24")
    expect(limitLine("instagram", "TIME", 60, over)).toBe("Instagram: 1 h 20 min today, past your 1 h. Kept 6 of the last 7 days. Tomorrow starts fresh.")
    const none = limitStatus(0, [], "2026-10-24", "2026-10-24")
    expect(limitLine("sugar", "COUNT", 0, none)).toBe("Sugar: none so far today.")
    for (const s of [createdReply("sugar", "COUNT", 0), createdReply("instagram", "TIME", 60), limitLine("instagram", "TIME", 60, over)]) {
      expect(s).not.toMatch(/streak|fail|lazy|red|shame|should|behind/i)
    }
  })
})
