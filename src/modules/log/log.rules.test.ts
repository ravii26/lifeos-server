import { describe, expect, it } from "vitest"
import {
  answerSleep,
  answerSpend,
  answerWeight,
  categoryOf,
  entryReceipt,
  latestPerDay,
  logIntent,
  matchCountHabit,
  periodRange,
  type LogRow,
} from "./log.rules.js"

const row = (date: string, value: number, label: string | null = null, minute = 0): LogRow => ({
  date,
  value,
  label,
  createdAt: new Date(Date.UTC(2026, 9, 24, 8, minute)),
})

describe("logIntent: entries", () => {
  it("reads spending with and without a reason", () => {
    expect(logIntent("spent 250 on lunch")).toEqual({ kind: "ENTRY", series: "money", value: 250, unit: "₹", label: "lunch", dayOffset: 0 })
    expect(logIntent("Spent ₹1,200 on my groceries")).toMatchObject({ value: 1200, label: "groceries" })
    expect(logIntent("paid 649 for netflix.")).toMatchObject({ value: 649, label: "netflix" })
    expect(logIntent("250 on chai")).toMatchObject({ value: 250, label: "chai" })
    expect(logIntent("spent 500")).toMatchObject({ value: 500, label: null })
    expect(logIntent("spent 80 on a cab yesterday")).toMatchObject({ value: 80, label: "cab", dayOffset: -1 })
  })
  it("does not take time spent as money", () => {
    expect(logIntent("spent 2 hours on DSA")).toBeNull()
    expect(logIntent("spent 30 min on english")).toBeNull()
  })
  it("reads sleep", () => {
    expect(logIntent("slept 6 hours")).toMatchObject({ series: "sleep", value: 6, unit: "h" })
    expect(logIntent("I slept 6.5")).toMatchObject({ value: 6.5 })
    expect(logIntent("got 5 hours of sleep")).toMatchObject({ value: 5 })
    expect(logIntent("slept 30 hours")).toBeNull()
  })
  it("reads weight and rejects odd numbers", () => {
    expect(logIntent("weight 74")).toMatchObject({ series: "weight", value: 74, unit: "kg" })
    expect(logIntent("my weight is 74.2 kg")).toMatchObject({ value: 74.2 })
    expect(logIntent("I weigh 84")).toMatchObject({ value: 84 })
    expect(logIntent("weight 7")).toBeNull()
  })
  it("leaves everything else to the AI", () => {
    expect(logIntent("hello")).toBeNull()
    expect(logIntent("I spent the whole day thinking about my job and what to do next")).toBeNull()
    expect(logIntent("remind me to pay rent tomorrow at 9 am")).toBeNull()
  })
})

describe("logIntent: counts", () => {
  it("reads +N, verbs and one-glass phrases", () => {
    expect(logIntent("+1 water")).toEqual({ kind: "COUNT", n: 1, what: "water" })
    expect(logIntent("+2 glasses of water")).toEqual({ kind: "COUNT", n: 2, what: "glasses of water" })
    expect(logIntent("water +1")).toEqual({ kind: "COUNT", n: 1, what: "water" })
    expect(logIntent("drank 2 glasses of water")).toEqual({ kind: "COUNT", n: 2, what: "glasses of water" })
    expect(logIntent("I had a glass of water")).toEqual({ kind: "COUNT", n: 1, what: "glass of water" })
    expect(logIntent("drank water")).toEqual({ kind: "COUNT", n: 1, what: "water" })
  })

  it("reads a daily count to keep", () => {
    const water = { kind: "TRACK", what: "water", target: 8, unit: "glasses" }
    expect(logIntent("Track water, 8 glasses a day")).toEqual(water)
    expect(logIntent("track my water 8 glasses daily")).toEqual(water)
    expect(logIntent("Drink 8 glasses of water a day")).toEqual(water)
    expect(logIntent("I want to drink 8 glasses of water every day")).toEqual(water)
    expect(logIntent("8 glasses of water a day")).toEqual(water)
    expect(logIntent("water: 8 glasses a day")).toEqual(water)
    // Logging what happened stays a count, not a new target.
    expect(logIntent("drank 2 glasses of water")).toEqual({ kind: "COUNT", n: 2, what: "glasses of water" })
    expect(logIntent("track water")).toBeNull()
  })
})

describe("logIntent: questions", () => {
  it("reads spending questions with a period and a reason", () => {
    expect(logIntent("how much did I spend this month?")).toEqual({ kind: "ASK", series: "money", period: "MONTH", label: null })
    expect(logIntent("how much did I spend on food this week")).toEqual({ kind: "ASK", series: "money", period: "WEEK", label: "food" })
    expect(logIntent("what did I spend yesterday")).toMatchObject({ period: "YESTERDAY" })
    expect(logIntent("how much did I spend")).toEqual({ kind: "ASK", series: "money", period: null, label: null })
  })
  it("reads sleep and weight questions", () => {
    expect(logIntent("how did I sleep this week?")).toEqual({ kind: "ASK", series: "sleep", period: "WEEK", label: null })
    expect(logIntent("how much did I sleep this week")).toEqual({ kind: "ASK", series: "sleep", period: "WEEK", label: null })
    expect(logIntent("what's my average sleep")).toMatchObject({ series: "sleep" })
    expect(logIntent("what's my weight?")).toMatchObject({ kind: "ASK", series: "weight" })
    expect(logIntent("weight trend")).toMatchObject({ kind: "ASK", series: "weight" })
  })
})

describe("matchCountHabit", () => {
  const habits = [
    { id: "w", title: "Drink 8 glasses of water" },
    { id: "g", title: "Gym" },
    { id: "r", title: "Read 20 pages" },
  ]
  it("finds the habit the words point at", () => {
    expect(matchCountHabit("glasses of water", habits)?.id).toBe("w")
    expect(matchCountHabit("water", habits)?.id).toBe("w")
    expect(matchCountHabit("pages", habits)?.id).toBe("r")
  })
  it("returns null when nothing or more than one matches", () => {
    expect(matchCountHabit("meetings", habits)).toBeNull()
    expect(matchCountHabit("glasses", habits)).toBeNull() // only filler words
    expect(matchCountHabit("water", [...habits, { id: "w2", title: "Water the plants" }])).toBeNull()
  })
})

describe("categories and periods", () => {
  it("groups raw words", () => {
    expect(categoryOf("lunch")).toBe("food")
    expect(categoryOf("uber to office")).toBe("transport")
    expect(categoryOf("netflix")).toBe("subscriptions")
    expect(categoryOf("gift for mom")).toBe("other")
    expect(categoryOf(null)).toBe("other")
  })
  it("works out day ranges (24 Oct 2026 is a Saturday)", () => {
    expect(periodRange("TODAY", "2026-10-24")).toEqual({ from: "2026-10-24", to: "2026-10-24" })
    expect(periodRange("WEEK", "2026-10-24")).toEqual({ from: "2026-10-19", to: "2026-10-24" })
    expect(periodRange("LAST_7", "2026-10-24")).toEqual({ from: "2026-10-18", to: "2026-10-24" })
    expect(periodRange("MONTH", "2026-10-24")).toEqual({ from: "2026-10-01", to: "2026-10-24" })
    expect(periodRange("LAST_MONTH", "2026-10-24")).toEqual({ from: "2026-09-01", to: "2026-09-30" })
    expect(periodRange("WEEK", "2026-10-19")).toEqual({ from: "2026-10-19", to: "2026-10-19" })
  })
})

describe("answers", () => {
  it("totals spending, by reason or by category", () => {
    const rows = [row("2026-10-20", 250, "lunch"), row("2026-10-21", 120, "uber"), row("2026-10-22", 180, "dinner")]
    expect(answerSpend(rows, "MONTH", null)).toBe("You spent ₹550 this month, across 3 entries. Most went on food (₹430), transport (₹120).")
    expect(answerSpend(rows, "WEEK", "food")).toBe("You spent ₹430 on food this week, across 2 entries.")
    expect(answerSpend([], "TODAY", "food")).toBe("Nothing logged on food today.")
  })
  it("formats Indian digit grouping", () => {
    expect(entryReceipt({ series: "money", value: 250, label: "lunch" }, 123456)).toBe("Logged ₹250 for lunch. ₹1,23,456 this month so far.")
  })
  it("uses the latest sleep entry of a day", () => {
    const rows = [row("2026-10-23", 5, null, 0), row("2026-10-23", 6, null, 5), row("2026-10-24", 8)]
    expect(latestPerDay(rows).map((r) => r.value)).toEqual([6, 8])
    expect(answerSleep(rows, "WEEK")).toBe("Your average this week is 7 h over 2 nights. The latest was 8 h.")
    expect(answerSleep([], "WEEK")).toContain("No sleep logged")
  })
  it("says how weight moved, plainly", () => {
    expect(answerWeight([row("2026-10-01", 76), row("2026-10-24", 74.5)])).toBe("Your weight is 74.5 kg, down 1.5 kg since 2026-10-01 (2 readings).")
    expect(answerWeight([row("2026-10-24", 74)])).toContain("74 kg")
    expect(answerWeight([])).toContain("No weight logged yet")
  })
})
