import { describe, expect, it } from "vitest"
import { asDirectness, asFocus, preferenceIntent, styleForPrompt, wantsAdvice } from "./personalization.rules.js"
import { adviseNow, type AdviceInput } from "../now/brain.rules.js"

describe("personalization defaults change nothing", () => {
  it("the defaults add nothing to the prompt", () => {
    expect(styleForPrompt("ALL", "BALANCED")).toBe("")
  })
  it("unknown stored values fall back to the defaults", () => {
    expect(asFocus("nonsense")).toBe("ALL")
    expect(asFocus(null)).toBe("ALL")
    expect(asDirectness(undefined)).toBe("BALANCED")
  })
  it("each non-default adds its own line", () => {
    expect(styleForPrompt("REMEMBER", "BALANCED")).toMatch(/remember and remind/)
    expect(styleForPrompt("ALL", "DIRECT")).toMatch(/direct/i)
    expect(styleForPrompt("ALL", "GENTLE")).toMatch(/gentle/i)
    expect(styleForPrompt("SUPPORT", "GENTLE")).toMatch(/talk to.*gentle/is)
  })
  it("reminders-only and support-only people get no advice", () => {
    expect(wantsAdvice("ALL")).toBe(true)
    expect(wantsAdvice("GOALS")).toBe(true)
    expect(wantsAdvice("REMEMBER")).toBe(false)
    expect(wantsAdvice("SUPPORT")).toBe(false)
  })
})

describe("setting them by saying so", () => {
  it("understands short phrases", () => {
    expect(preferenceIntent("be more direct with me")).toEqual({ directness: "DIRECT" })
    expect(preferenceIntent("don't sugarcoat")).toEqual({ directness: "DIRECT" })
    expect(preferenceIntent("Please be gentle.")).toEqual({ directness: "GENTLE" })
    expect(preferenceIntent("go easy on me")).toEqual({ directness: "GENTLE" })
    expect(preferenceIntent("talk normally")).toEqual({ directness: "BALANCED" })
    expect(preferenceIntent("I only want reminders")).toEqual({ focus: "REMEMBER" })
    expect(preferenceIntent("just remind me of things")).toEqual({ focus: "REMEMBER" })
    expect(preferenceIntent("help me with everything")).toEqual({ focus: "ALL" })
  })
  it("leaves real requests to the AI", () => {
    expect(preferenceIntent("remind me to call mom")).toBeNull()
    expect(preferenceIntent("just remind me to pay the bill tomorrow at 5")).toBeNull()
    expect(preferenceIntent("be direct about whether I should quit my job and move to another city")).toBeNull()
    expect(preferenceIntent("I want to be honest about my goals")).toBeNull()
  })
})

const base: AdviceInput = {
  nowMin: 23 * 60,
  blocks: [{ block: "NIGHT", start: "22:30", end: "24:00", freeMinutes: 30 }],
  block: "NIGHT",
  top: { sourceType: "PROJECT", sourceId: "p1", title: "Revision", minutes: 45, fullMinutes: 45, smaller: false },
  skips14d: 0,
  savesToday: 0,
  savesActedToday: 0,
}

describe("advice follows directness", () => {
  it("balanced is the original behaviour", () => {
    expect(adviseNow(base)?.kind).toBe("LATE_NIGHT")
    expect(adviseNow({ ...base, directness: "BALANCED" })?.kind).toBe("LATE_NIGHT")
  })
  it("gentle never says it is too late", () => {
    expect(adviseNow({ ...base, directness: "GENTLE" })).toBeNull()
  })
  it("gentle softens a slipping item but still offers the options", () => {
    const a = adviseNow({ ...base, nowMin: 10 * 60, directness: "GENTLE", skips14d: 3 })
    expect(a?.kind).toBe("KEEPS_SLIPPING")
    expect(a?.message).not.toMatch(/keeps slipping/)
    expect(a?.actions.length).toBeGreaterThanOrEqual(3)
  })
  it("direct speaks up sooner and plainer", () => {
    const day = { ...base, nowMin: 10 * 60, skips14d: 2 }
    expect(adviseNow(day)).toBeNull() // balanced waits for 3
    const a = adviseNow({ ...day, directness: "DIRECT" })
    expect(a?.kind).toBe("KEEPS_SLIPPING")
    expect(a?.message).toMatch(/too big or not a priority/)
    expect(adviseNow({ ...day, skips14d: 0, savesToday: 3, directness: "DIRECT" })?.kind).toBe("SAVES_PILING")
    expect(adviseNow({ ...day, skips14d: 0, savesToday: 3 })).toBeNull()
  })
})

describe("how much Ally messages by itself", () => {
  it("quieter, silent, normal", () => {
    expect(preferenceIntent("be quieter")).toEqual({ proactivity: "QUIETER" })
    expect(preferenceIntent("Please message me less")).toEqual({ proactivity: "QUIETER" })
    expect(preferenceIntent("send me fewer notifications")).toEqual({ proactivity: "QUIETER" })
    expect(preferenceIntent("go silent")).toEqual({ proactivity: "SILENT" })
    expect(preferenceIntent("silent mode")).toEqual({ proactivity: "SILENT" })
    expect(preferenceIntent("stop messaging me")).toEqual({ proactivity: "SILENT" })
    expect(preferenceIntent("don't message me")).toEqual({ proactivity: "SILENT" })
    expect(preferenceIntent("message me normally")).toEqual({ proactivity: "NORMAL" })
    expect(preferenceIntent("turn notifications back on")).toEqual({ proactivity: "NORMAL" })
  })
  it("does not catch reminders or nudges the person set", () => {
    expect(preferenceIntent("stop the nightly reminders")).toBeNull()
    expect(preferenceIntent("remind me to message mom")).toBeNull()
    expect(preferenceIntent("I only want reminders")).toEqual({ focus: "REMEMBER" }) // unchanged
  })
})
