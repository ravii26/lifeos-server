import { describe, it, expect } from "vitest"
import { summarizeAiCalls, isAdminEmail, progressCounters, type AiCallRow } from "./admin.rules.js"

const prices = { "gemini-x": { inPerM: 1, outPerM: 2 } }
const now = new Date("2026-10-15T12:00:00+05:30")
const opts = { now, timeZone: "Asia/Kolkata", prices, usdInr: 100 }

const row = (over: Partial<AiCallRow>): AiCallRow => ({
  userId: "u1",
  feature: "Assistant chat",
  provider: "gemini",
  model: "gemini-x",
  tokensIn: 1_000_000,
  tokensOut: 500_000,
  durationMs: 1000,
  ok: true,
  createdAt: now,
  ...over,
})

describe("summarizeAiCalls", () => {
  it("prices a call in rupees", () => {
    // 1M in × $1 + 0.5M out × $2 = $2 → ₹200 at 100 ₹/$
    const s = summarizeAiCalls([row({})], opts)
    expect(s.today.costInr).toBe(200)
    expect(s.today.calls).toBe(1)
    expect(s.today.tokensIn).toBe(1_000_000)
  })

  it("splits today, the last 7 days and the last 30 days by local day", () => {
    const s = summarizeAiCalls(
      [
        row({}),
        row({ createdAt: new Date("2026-10-14T23:59:00+05:30") }), // yesterday (IST)
        row({ createdAt: new Date("2026-10-01T10:00:00+05:30") }), // 14 days ago
        row({ createdAt: new Date("2026-09-01T10:00:00+05:30") }), // older than 30 days: ignored
      ],
      opts,
    )
    expect(s.today.calls).toBe(1)
    expect(s.last7Days.calls).toBe(2)
    expect(s.last30Days.calls).toBe(3)
    expect(s.byDay.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-14", "2026-10-15"])
  })

  it("never invents a price: unpriced models are counted and named, not costed", () => {
    const s = summarizeAiCalls([row({ model: "mystery" }), row({})], opts)
    expect(s.today.costInr).toBe(200)
    expect(s.today.unpricedCalls).toBe(1)
    expect(s.unpricedModels).toEqual(["mystery"])
  })

  it("counts failures but does not bill them", () => {
    const s = summarizeAiCalls([row({ ok: false, tokensIn: 0, tokensOut: 0, model: "mystery" })], opts)
    expect(s.today.failures).toBe(1)
    expect(s.today.unpricedCalls).toBe(0)
    expect(s.unpricedModels).toEqual([])
  })

  it("groups by feature and model, most expensive first", () => {
    const s = summarizeAiCalls(
      [row({ feature: "Save video summary", tokensIn: 5_000_000 }), row({}), row({ durationMs: 3000 })],
      opts,
    )
    expect(s.byFeature[0]!.feature).toBe("Save video summary")
    expect(s.byFeature[1]).toMatchObject({ feature: "Assistant chat", calls: 2, avgMs: 2000 })
    expect(s.byModel).toHaveLength(1)
  })
})

describe("isAdminEmail", () => {
  it("matches case-insensitively from a comma list", () => {
    expect(isAdminEmail("Me@Example.com", "a@b.com, me@example.com")).toBe(true)
    expect(isAdminEmail("other@example.com", "me@example.com")).toBe(false)
    expect(isAdminEmail("me@example.com", undefined)).toBe(false)
    expect(isAdminEmail(undefined, "me@example.com")).toBe(false)
  })
})

describe("progressCounters", () => {
  const day = 86_400_000
  const t = new Date("2026-11-12T12:00:00Z")
  const ago = (d: number) => new Date(t.getTime() - d * day)

  it("counts done and dropped this week, and active people", () => {
    const p = progressCounters({
      weekEvents: [
        { userId: "a", type: "DONE" },
        { userId: "a", type: "MINIMUM" },
        { userId: "b", type: "LOGGED" },
        { userId: "b", type: "ARCHIVED" },
        { userId: "b", type: "SKIPPED" },
      ],
      users: [],
      now: t,
    })
    expect(p.doneThisWeek).toBe(3)
    expect(p.droppedThisWeek).toBe(1)
    expect(p.activeThisWeek).toBe(2)
    expect(p.donePerActiveUser).toBe(2)
  })

  it("works out day-7 and day-30 return from sign-up and last activity", () => {
    const p = progressCounters({
      weekEvents: [],
      users: [
        { id: "new", createdAt: ago(3), lastActivityAt: ago(1) }, // too new for either
        { id: "back", createdAt: ago(20), lastActivityAt: ago(2) }, // returned after day 7
        { id: "gone", createdAt: ago(20), lastActivityAt: ago(19) }, // stopped on day 1
        { id: "old", createdAt: ago(40), lastActivityAt: ago(1) }, // still here after day 30
      ],
      now: t,
    })
    expect(p.return7).toEqual({ eligible: 3, returned: 2, rate: 2 / 3 })
    expect(p.return30).toEqual({ eligible: 1, returned: 1, rate: 1 })
    expect(p.donePerActiveUser).toBeNull()
  })
})
