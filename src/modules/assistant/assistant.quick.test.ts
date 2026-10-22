import { describe, expect, it } from "vitest"
import { matchTarget, quickIntent, type TargetOption } from "./assistant.quick.js"

const at = (h: number, m = 0) => h * 60 + m

describe("quickIntent: busy", () => {
  it("meeting till 4 in the afternoon", () => {
    expect(quickIntent("in a meeting till 4", at(14))).toEqual({ kind: "BUSY", until: "16:00" })
    expect(quickIntent("busy until 5:30 pm", at(14))).toEqual({ kind: "BUSY", until: "17:30" })
  })
  it("busy for an hour / 30 minutes", () => {
    expect(quickIntent("I'm in a call for an hour", at(15, 10))).toEqual({ kind: "BUSY", until: "16:10" })
    expect(quickIntent("stuck in a meeting for 30 minutes", at(11))).toEqual({ kind: "BUSY", until: "11:30" })
  })
  it("free again", () => {
    expect(quickIntent("I'm free now", at(16))).toEqual({ kind: "BUSY", until: null })
    expect(quickIntent("meeting is over", at(16))).toEqual({ kind: "BUSY", until: null })
  })
  it("a time already past is not a busy-until", () => {
    expect(quickIntent("meeting till 9 am", at(14))).toBeNull()
  })
})

describe("quickIntent: progress", () => {
  it("minutes", () => {
    expect(quickIntent("30 min English", at(9))).toEqual({ kind: "LOG", minutes: 30, what: "English" })
    expect(quickIntent("did 1.5 hours of system design", at(9))).toEqual({ kind: "LOG", minutes: 90, what: "system design" })
  })
  it("counts", () => {
    expect(quickIntent("applied to 2 jobs", at(9))).toMatchObject({ kind: "LOG", count: 2 })
    expect(quickIntent("solved 3 problems", at(9))).toEqual({ kind: "LOG", count: 3, what: "problems" })
  })
  it("long or unrelated messages go to the AI", () => {
    expect(quickIntent("remind me at 6 to call mom", at(9))).toBeNull()
    expect(quickIntent("I spent 30 min arguing with my manager about the roadmap and now I feel drained", at(9))).toBeNull()
  })
})

describe("matchTarget", () => {
  const targets: TargetOption[] = [
    { id: "dsa", title: "DSA", countUnit: null, unit: "min" },
    { id: "eng", title: "English speaking", countUnit: null, unit: "min" },
    { id: "apps", title: "Job applications", countUnit: "applications", unit: "count" },
    { id: "probs", title: "DSA problems", countUnit: "problems", unit: "count" },
  ]
  it("finds the one target the words mean", () => {
    expect(matchTarget("English", "min", targets)?.id).toBe("eng")
    expect(matchTarget("applications jobs", "count", targets)?.id).toBe("apps")
    expect(matchTarget("problems", "count", targets)?.id).toBe("probs")
  })
  it("no match, or a tie, is left to the AI", () => {
    expect(matchTarget("guitar", "min", targets)).toBeNull()
    expect(matchTarget("stuff", "count", targets)).toBeNull()
  })
})

describe("starter reminders are understood by code", () => {
  it("today / tomorrow / every day, with am or pm", () => {
    expect(quickIntent("Remind me to call mom tomorrow at 9 am", 600)).toEqual({ kind: "REMIND", text: "call mom", day: "TOMORROW", time: "09:00" })
    expect(quickIntent("Remind me to take vitamins every day at 9 am", 600)).toEqual({ kind: "REMIND", text: "take vitamins", day: "DAILY", time: "09:00" })
    expect(quickIntent("Remind me to pay rent today at 1:30 pm", 600)).toEqual({ kind: "REMIND", text: "pay rent", day: "TODAY", time: "13:30" })
    expect(quickIntent("remind me to sleep today at 12 am", 600)).toEqual({ kind: "REMIND", text: "sleep", day: "TODAY", time: "00:00" })
  })
  it("anything vaguer is left to the AI", () => {
    expect(quickIntent("Remind me to call mom tomorrow at 9", 600)).toBeNull()
    expect(quickIntent("Remind me to call mom friday 6pm", 600)).toBeNull()
  })
})
