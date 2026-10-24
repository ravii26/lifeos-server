import { describe, expect, it } from "vitest"
import { MAX_PER_DAY, QUESTIONS, answeredCount, askedToday, nextQuestion, parseHours, parseTime, type KnowEvent, type KnowId, type KnowState } from "./getknow.rules.js"

const DAY = 86_400_000
const noon = new Date("2026-10-24T06:30:00Z") // midday in India
const midnight = new Date("2026-10-23T18:30:00Z").getTime() // the start of that local day

const state = (events: KnowEvent[] = [], known: KnowId[] = [], now = noon, todayStartMs = midnight): KnowState => ({ events, known: new Set(known), now, todayStartMs })
const ev = (id: KnowId, at: Date, skipped = false, value = "x"): KnowEvent => ({ id, at, skipped, value: skipped ? "" : value })

describe("which question comes next", () => {
  it("starts with the goal, then follows the list in order", () => {
    expect(nextQuestion(state())?.id).toBe("goal")
    expect(nextQuestion(state([ev("goal", new Date(noon.getTime() - 3 * DAY))]))?.id).toBe("wake")
  })
  it("never more than two a day", () => {
    const today = [ev("goal", new Date(noon.getTime() - 3600_000)), ev("wake", new Date(noon.getTime() - 1800_000))]
    expect(askedToday(state(today))).toBe(2)
    expect(MAX_PER_DAY).toBe(2)
    expect(nextQuestion(state(today))).toBeNull()
    // The next day it carries on.
    expect(nextQuestion(state(today, [], new Date(noon.getTime() + DAY), midnight + DAY))?.id).toBe("sleep")
  })
  it("a skipped question rests for a week, comes back once, and a second skip ends it", () => {
    const skippedAt = new Date(noon.getTime() - 2 * DAY)
    expect(nextQuestion(state([ev("goal", skippedAt, true)]))?.id).toBe("wake") // goal is resting
    expect(nextQuestion(state([ev("goal", new Date(noon.getTime() - 8 * DAY), true)]))?.id).toBe("goal") // back after a week
    const twice = [ev("goal", new Date(noon.getTime() - 20 * DAY), true), ev("goal", new Date(noon.getTime() - 9 * DAY), true)]
    expect(nextQuestion(state(twice))?.id).toBe("wake")
  })
  it("never asks what Ally already knows", () => {
    expect(nextQuestion(state([], ["goal", "wake", "sleep", "hours"]))?.id).toBe("drain")
    expect(answeredCount(state([], ["goal", "wake"]))).toBe(2)
  })
  it("stops when every question is answered", () => {
    const all = QUESTIONS.map((q) => q.id)
    expect(nextQuestion(state([], all))).toBeNull()
  })
  it("every question is usable: text, a reason, and chips or free text", () => {
    for (const q of QUESTIONS) {
      expect(q.text.length).toBeGreaterThan(10)
      expect(q.why.length).toBeGreaterThan(5)
      expect(q.options.length > 0 || q.allowText).toBe(true)
    }
  })
})

describe("reading a time", () => {
  it("the chips", () => {
    expect(parseTime("6 to 7", "wake")).toBe("06:30")
    expect(parseTime("Before 5", "wake")).toBe("04:30")
    expect(parseTime("11 to 12", "sleep")).toBe("23:30")
    expect(parseTime("12 to 1", "sleep")).toBe("00:30")
  })
  it("typed times", () => {
    expect(parseTime("6:30", "wake")).toBe("06:30")
    expect(parseTime("7 am", "wake")).toBe("07:00")
    expect(parseTime("5.45", "wake")).toBe("05:45")
    expect(parseTime("11", "sleep")).toBe("23:00")
    expect(parseTime("11:30 pm", "sleep")).toBe("23:30")
    expect(parseTime("12", "sleep")).toBe("00:00")
    expect(parseTime("1 am", "sleep")).toBe("01:00")
    expect(parseTime("whenever", "wake")).toBeNull()
  })
})

describe("reading work hours", () => {
  it("typed and chips", () => {
    expect(parseHours("9 to 6")).toEqual({ start: "09:00", end: "18:00" })
    expect(parseHours("10 to 8:30")).toEqual({ start: "10:00", end: "20:30" })
    expect(parseHours("8 to 2")).toEqual({ start: "08:00", end: "14:00" })
    expect(parseHours("9-5")).toEqual({ start: "09:00", end: "17:00" })
    expect(parseHours("9am to 5:30pm")).toEqual({ start: "09:00", end: "17:30" })
  })
  it("no fixed hours", () => {
    expect(parseHours("I don't have fixed hours")).toEqual({ none: true })
    expect(parseHours("flexible")).toEqual({ none: true })
  })
  it("nonsense and overnight are not guessed", () => {
    expect(parseHours("all day")).toBeNull()
    expect(parseHours("9 pm to 6 am")).toBeNull()
    expect(parseHours("9")).toBeNull()
  })
})
