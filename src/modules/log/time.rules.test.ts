import { describe, expect, it } from "vitest"
import {
  byLabel,
  duration,
  elapsedMinutes,
  forgottenReply,
  isForgotten,
  startedReply,
  stoppedReply,
  timeIntent,
  whereTimeWent,
} from "./time.rules.js"

describe("timeIntent", () => {
  it("starts a timer, with or without a name", () => {
    expect(timeIntent("start timer for DSA")).toEqual({ kind: "START", what: "dsa" })
    expect(timeIntent("start a timer on my resume")).toEqual({ kind: "START", what: "resume" })
    expect(timeIntent("start gym timer")).toEqual({ kind: "START", what: "gym" })
    expect(timeIntent("timer for english")).toEqual({ kind: "START", what: "english" })
    expect(timeIntent("start timer")).toEqual({ kind: "START", what: null })
  })
  it("stops, with the clock or with the minutes the person says", () => {
    expect(timeIntent("stop timer")).toEqual({ kind: "STOP", minutes: null })
    expect(timeIntent("stop the timer")).toEqual({ kind: "STOP", minutes: null })
    expect(timeIntent("stop timer, it was 45 min")).toEqual({ kind: "STOP", minutes: 45 })
    expect(timeIntent("stop my timer it was about 1.5 hours")).toEqual({ kind: "STOP", minutes: 90 })
  })
  it("asks about and discards the running timer", () => {
    expect(timeIntent("how long has it been?")).toEqual({ kind: "STATUS" })
    expect(timeIntent("is my timer running")).toEqual({ kind: "STATUS" })
    expect(timeIntent("discard timer")).toEqual({ kind: "DISCARD" })
    expect(timeIntent("cancel my timer")).toEqual({ kind: "DISCARD" })
  })
  it("reads where the time went, with a period", () => {
    expect(timeIntent("where did my time go today?")).toEqual({ kind: "WHERE", period: "TODAY" })
    expect(timeIntent("where did my day go")).toEqual({ kind: "WHERE", period: "TODAY" })
    expect(timeIntent("where did my week go")).toEqual({ kind: "WHERE", period: "WEEK" })
    expect(timeIntent("where did my time go this week")).toEqual({ kind: "WHERE", period: "WEEK" })
    expect(timeIntent("where did my time go yesterday")).toEqual({ kind: "WHERE", period: "YESTERDAY" })
    expect(timeIntent("time report this month")).toEqual({ kind: "WHERE", period: "MONTH" })
  })
  it("leaves everything else alone", () => {
    expect(timeIntent("how did my day go")).toBeNull()
    expect(timeIntent("stop")).toBeNull()
    expect(timeIntent("stop the nudges")).toBeNull()
    expect(timeIntent("start my day")).toBeNull()
    expect(timeIntent("what time is it")).toBeNull()
    expect(timeIntent("I started a new project at work and the timer thing is confusing")).toBeNull()
  })
})

describe("forgotten timers", () => {
  it("measures and flags", () => {
    const start = new Date(Date.UTC(2026, 9, 24, 4, 0))
    expect(elapsedMinutes(start, new Date(Date.UTC(2026, 9, 24, 4, 45)))).toBe(45)
    expect(isForgotten(240)).toBe(false)
    expect(isForgotten(241)).toBe(true)
  })
})

describe("answers", () => {
  it("adds up the same label and puts the biggest first", () => {
    expect(byLabel([{ label: "DSA", minutes: 30 }, { label: "gym", minutes: 45 }, { label: "dsa", minutes: 25 }])).toEqual([
      { label: "DSA", minutes: 55 },
      { label: "gym", minutes: 45 },
    ])
  })
  it("says where time went without judging the rest", () => {
    const text = whereTimeWent([{ label: "dsa", minutes: 70 }, { label: "gym", minutes: 45 }], "TODAY", null)
    expect(text).toBe("Today: Dsa 1 h 10 min, Gym 45 min. 1 h 55 min timed in all.")
    expect(whereTimeWent([], "WEEK", null)).toContain("Nothing was timed this week")
    expect(whereTimeWent([], "TODAY", "dsa")).toContain("still running")
    expect(text).not.toMatch(/wast|lazy|idle|behind|should|only/i)
  })
  it("formats, and the forgotten-timer reply invents no number", () => {
    expect(duration(0)).toBe("under a minute")
    expect(duration(125)).toBe("2 h 5 min")
    expect(startedReply("dsa", { label: "gym", minutes: 20 })).toBe('Stopped gym at 20 min. Timer started for dsa. Say "stop timer" when you\'re done.')
    expect(stoppedReply("dsa", 45, "Counts toward this week.")).toBe("Stopped dsa: 45 min. Counts toward this week.")
    expect(forgottenReply("dsa", 312)).toContain("5 h 12 min")
    expect(forgottenReply("dsa", 312)).toContain("discard timer")
  })
})
