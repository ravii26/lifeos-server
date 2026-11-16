import { describe, expect, it } from "vitest"
import { checkWhen, parseWhen, whenAllows, whenFor, whenWords, type When } from "./when.rules.js"

// 2026-11-18 is a Wednesday.
const TODAY = "2026-11-18"
const w = (p: Partial<When>): When => ({ dueKind: null, dueKey: null, windowFrom: null, windowTo: null, ...p })

describe("when a step may be suggested", () => {
  it("an 'on tomorrow' step is not shown today, and is shown on its day and after", () => {
    const step = w({ dueKind: "ON", dueKey: "2026-11-19" })
    expect(whenAllows(step, TODAY, 600)).toBe(false)
    expect(whenAllows(step, "2026-11-19", 600)).toBe(true)
    expect(whenAllows(step, "2026-11-20", 600)).toBe(true)
  })
  it("a 'by Friday' step is shown any day until then", () => {
    expect(whenAllows(w({ dueKind: "BY", dueKey: "2026-11-20" }), TODAY, 600)).toBe(true)
  })
  it("a date with no kind (an older to-do) behaves as 'by'", () => {
    expect(whenAllows(w({ dueKey: "2026-11-25" }), TODAY, 600)).toBe(true)
  })
  it("a 6 to 8 am window is shown at 7, not at 9, and not at 5:59", () => {
    const run = w({ windowFrom: "06:00", windowTo: "08:00" })
    expect(whenAllows(run, TODAY, 7 * 60)).toBe(true)
    expect(whenAllows(run, TODAY, 9 * 60)).toBe(false)
    expect(whenAllows(run, TODAY, 5 * 60 + 59)).toBe(false)
    expect(whenAllows(run, TODAY, 8 * 60)).toBe(false)
  })
  it("a window past midnight wraps", () => {
    const late = w({ windowFrom: "22:00", windowTo: "01:00" })
    expect(whenAllows(late, TODAY, 23 * 60)).toBe(true)
    expect(whenAllows(late, TODAY, 30)).toBe(true)
    expect(whenAllows(late, TODAY, 12 * 60)).toBe(false)
  })
  it("a day and a window together need both", () => {
    const step = w({ dueKind: "ON", dueKey: "2026-11-19", windowFrom: "06:00", windowTo: "09:00" })
    expect(whenAllows(step, TODAY, 7 * 60)).toBe(false)
    expect(whenAllows(step, "2026-11-19", 7 * 60)).toBe(true)
    expect(whenAllows(step, "2026-11-19", 12 * 60)).toBe(false)
  })
})

describe("when in plain words", () => {
  it("says each kind plainly", () => {
    expect(whenWords(w({}), TODAY)).toBeNull()
    expect(whenWords(w({ dueKind: "ON", dueKey: "2026-11-19" }), TODAY)).toBe("Tomorrow")
    expect(whenWords(w({ dueKind: "ON", dueKey: "2026-11-21" }), TODAY)).toBe("Sat 21 Nov")
    expect(whenWords(w({ dueKind: "BY", dueKey: "2026-11-20" }), TODAY)).toBe("By Fri 20 Nov")
    expect(whenWords(w({ dueKind: "BY", dueKey: "2026-11-19" }), TODAY)).toBe("By tomorrow")
    expect(whenWords(w({ windowFrom: "06:00", windowTo: "08:00" }), TODAY)).toBe("Mornings 6 to 8")
    expect(whenWords(w({ windowFrom: "18:30", windowTo: "21:00" }), TODAY)).toBe("Evenings 6:30 to 9")
    expect(whenWords(w({ dueKind: "ON", dueKey: "2026-11-19", windowFrom: "06:00", windowTo: "08:00" }), TODAY)).toBe("Tomorrow, 6 to 8")
  })
  it("a day that has gone by is never called overdue", () => {
    expect(whenWords(w({ dueKind: "ON", dueKey: "2026-11-17" }), TODAY)).toBe("Today")
    expect(whenWords(w({ dueKind: "BY", dueKey: "2026-11-16" }), TODAY)).toBe("Was by Mon 16 Nov")
  })
})

describe("reading when from words with no AI", () => {
  it("a bare tomorrow is 'on' that day", () => {
    const p = parseWhen("Call the bank tomorrow", TODAY)
    expect(p).toMatchObject({ dueKind: "ON", dueKey: "2026-11-19", windowFrom: null })
    expect(p.rest).toBe("Call the bank")
  })
  it("by and before make a deadline", () => {
    expect(parseWhen("Send the resume by Friday", TODAY)).toMatchObject({ dueKind: "BY", dueKey: "2026-11-20", rest: "Send the resume" })
    expect(parseWhen("pay rent before the 20th", TODAY)).toMatchObject({ dueKind: "BY", dueKey: "2026-11-20" })
    expect(parseWhen("pay rent before the 5th", TODAY)).toMatchObject({ dueKind: "BY", dueKey: "2026-12-05" })
    expect(parseWhen("renew passport by 3 Jan", TODAY)).toMatchObject({ dueKind: "BY", dueKey: "2027-01-03" })
  })
  it("weekdays mean the next one", () => {
    expect(parseWhen("lunch with Asha on Saturday", TODAY)).toMatchObject({ dueKind: "ON", dueKey: "2026-11-21", rest: "lunch with Asha" })
    expect(parseWhen("review on Wednesday", TODAY)).toMatchObject({ dueKey: "2026-11-25" })
  })
  it("a window: hours, or a part of the day", () => {
    expect(parseWhen("Go running 6 to 8 am", TODAY)).toMatchObject({ dueKind: null, dueKey: null, windowFrom: "06:00", windowTo: "08:00", rest: "Go running" })
    expect(parseWhen("run 6-8", TODAY)).toMatchObject({ windowFrom: "06:00", windowTo: "08:00" })
    expect(parseWhen("gym 6-8 pm", TODAY)).toMatchObject({ windowFrom: "18:00", windowTo: "20:00" })
    expect(parseWhen("study 10 to 2 pm", TODAY)).toMatchObject({ windowFrom: "10:00", windowTo: "14:00" })
    expect(parseWhen("walk in the mornings", TODAY)).toMatchObject({ windowFrom: "06:00", windowTo: "09:00", rest: "walk" })
    expect(parseWhen("guitar in the evening 7-8", TODAY)).toMatchObject({ windowFrom: "19:00", windowTo: "20:00" })
  })
  it("amounts are not hours", () => {
    expect(parseWhen("read 5-10 pages", TODAY)).toMatchObject({ windowFrom: null, windowTo: null })
    expect(parseWhen("do 2-3 problems", TODAY)).toMatchObject({ windowFrom: null })
    expect(parseWhen("walk 3 to 5 km", TODAY)).toMatchObject({ windowFrom: null })
  })
  it("a day and a part of the day together", () => {
    expect(parseWhen("dentist tomorrow morning", TODAY)).toMatchObject({ dueKind: "ON", dueKey: "2026-11-19", windowFrom: "06:00", windowTo: "09:00", rest: "dentist" })
    expect(parseWhen("call mom tonight", TODAY)).toMatchObject({ dueKind: "ON", dueKey: TODAY, windowFrom: "21:00", windowTo: "23:00", rest: "call mom" })
  })
  it("understands Hinglish", () => {
    expect(parseWhen("kal bank jaana hai", TODAY)).toMatchObject({ dueKind: "ON", dueKey: "2026-11-19" })
    expect(parseWhen("Friday tak resume bhejna", TODAY)).toMatchObject({ dueKind: "BY", dueKey: "2026-11-20" })
    expect(parseWhen("subah running", TODAY)).toMatchObject({ windowFrom: "06:00", windowTo: "09:00" })
    expect(parseWhen("shaam ko 6 se 8 baje gym", TODAY)).toMatchObject({ windowFrom: "18:00", windowTo: "20:00" })
    expect(parseWhen("parso doctor", TODAY)).toMatchObject({ dueKind: "ON", dueKey: "2026-11-20" })
  })
  it("nothing said is anytime, with the words untouched", () => {
    expect(parseWhen("Fix the kitchen tap", TODAY)).toEqual({ dueKind: null, dueKey: null, windowFrom: null, windowTo: null, rest: "Fix the kitchen tap" })
  })
})

describe("checking what was sent", () => {
  it("drops a past day, a half window and a bad hour", () => {
    expect(checkWhen({ dueKind: "BY", dueKey: "2026-11-01" }, TODAY)).toEqual(w({}))
    expect(checkWhen({ windowFrom: "06:00" }, TODAY)).toEqual(w({}))
    expect(checkWhen({ windowFrom: "25:00", windowTo: "26:00" }, TODAY)).toEqual(w({}))
    expect(checkWhen({ dueKey: "2026-11-20" }, TODAY)).toEqual(w({ dueKind: "ON", dueKey: "2026-11-20" }))
  })
  it("the AI's date with the kind read from the words", () => {
    expect(whenFor("Send the resume by Friday", { dueKey: "2026-11-20" }, TODAY)).toEqual(w({ dueKind: "BY", dueKey: "2026-11-20" }))
    expect(whenFor("Call the bank", { dueKey: "2026-11-19" }, TODAY)).toEqual(w({ dueKind: "ON", dueKey: "2026-11-19" }))
    expect(whenFor("Go running 6 to 8 am", {}, TODAY)).toEqual(w({ windowFrom: "06:00", windowTo: "08:00" }))
  })
})
