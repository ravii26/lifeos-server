import { describe, expect, it } from "vitest"
import { localToUtc, nudgeRequest, parseClock, isCrisis, contentRedirect } from "./assistant.chat.js"

describe("localToUtc", () => {
  it("converts a local India time to UTC", () => {
    expect(localToUtc("2026-10-05T19:00", "Asia/Kolkata")?.toISOString()).toBe("2026-10-05T13:30:00.000Z")
  })
  it("rejects malformed input", () => {
    expect(localToUtc("tomorrow 7pm", "Asia/Kolkata")).toBeNull()
  })
})

describe("nudge requests", () => {
  it("reads times people actually type", () => {
    expect(parseClock("every night at 9:30 pm")).toBe("21:30")
    expect(parseClock("every night at 10")).toBe("22:00")
    expect(parseClock("each morning at 8")).toBe("08:00")
    expect(parseClock("at 21:15")).toBe("21:15")
  })
  it("turns nudges on and off only on a clear request", () => {
    expect(nudgeRequest("nudge me every night at 9:30 pm with my one thing")).toMatchObject({ kind: "NIGHTLY", time: "21:30" })
    expect(nudgeRequest("remind me every morning at 8")).toMatchObject({ kind: "MORNING", time: "08:00" })
    expect(nudgeRequest("stop the nightly nudges")).toMatchObject({ kind: "NIGHTLY", time: null })
    expect(nudgeRequest("remind me to call mom at 7")).toBeNull()
    expect(nudgeRequest("I feel low tonight")).toBeNull()
  })
})

describe("safety and pattern guards", () => {
  it("recognises crisis language and not ordinary tiredness", () => {
    expect(isCrisis("I don't want to live anymore")).toBe(true)
    expect(isCrisis("thinking about suicide")).toBe(true)
    expect(isCrisis("I'm dead tired after the gym")).toBe(false)
  })
  it("adds the evidence line only when asking for more content", () => {
    const p = [{ id: "CONSUMING_NOT_DOING", evidence: "Saved 7 things in 2 weeks and acted on 0." }]
    expect(contentRedirect("suggest one more video", p, "Try this one")).toContain("Saved 7")
    expect(contentRedirect("what should I do now", p, "Do X")).toBeNull()
    expect(contentRedirect("another video?", p, "You already saved plenty")).toBeNull()
    expect(contentRedirect("another video?", [], "Try this")).toBeNull()
  })
})
