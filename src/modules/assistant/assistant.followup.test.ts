import { describe, expect, it } from "vitest"
import { daysAhead, followUpIntent, lastRef, matchByTitle, resolveHour } from "./assistant.followup.js"

describe("follow-ups understood by code", () => {
  it("move it", () => {
    expect(followUpIntent("move it to tomorrow")).toEqual({ kind: "MOVE", when: { kind: "TOMORROW" } })
    expect(followUpIntent("Okay, push that to Friday.")).toEqual({ kind: "MOVE", when: { kind: "WEEKDAY", weekday: 5 } })
    expect(followUpIntent("postpone it to next week")).toEqual({ kind: "MOVE", when: { kind: "NEXT_WEEK" } })
    expect(followUpIntent("do it on the weekend")).toEqual({ kind: "MOVE", when: { kind: "WEEKEND" } })
    expect(followUpIntent("move it to tonight")).toEqual({ kind: "MOVE", when: { kind: "TONIGHT" } })
  })

  it("make it shorter or longer", () => {
    expect(followUpIntent("make it 30 min")).toEqual({ kind: "RESIZE", minutes: 30 })
    expect(followUpIntent("change that to 1.5 hours")).toEqual({ kind: "RESIZE", minutes: 90 })
  })

  it("change the time", () => {
    expect(followUpIntent("change it to 9 pm")).toEqual({ kind: "RETIME", hour: 9, minute: 0, ampm: "pm" })
    expect(followUpIntent("no, 8:30 instead")).toEqual({ kind: "RETIME", hour: 8, minute: 30, ampm: null })
    expect(followUpIntent("make it at 7am")).toEqual({ kind: "RETIME", hour: 7, minute: 0, ampm: "am" })
  })

  it("corrections name the thing", () => {
    expect(followUpIntent("no, gym is at 9 not 8")).toEqual({ kind: "CORRECT", what: "gym", hour: 9, minute: 0, ampm: null })
    expect(followUpIntent("No, my walk should be at 6:30 pm")).toEqual({ kind: "CORRECT", what: "walk", hour: 6, minute: 30, ampm: "pm" })
  })

  it("undo by voice", () => {
    expect(followUpIntent("undo that")).toEqual({ kind: "UNDO" })
    expect(followUpIntent("delete it")).toEqual({ kind: "UNDO" })
  })

  it("questions answered from real data", () => {
    for (const q of ["what's my day?", "What is left for today", "what's left", "show me my plan for today", "what do I have today"]) {
      expect(followUpIntent(q), q).toEqual({ kind: "DAY" })
    }
    expect(followUpIntent("what did I do yesterday?")).toEqual({ kind: "DONE_ON", day: "YESTERDAY" })
    expect(followUpIntent("what have I done today")).toEqual({ kind: "DONE_ON", day: "TODAY" })
    expect(followUpIntent("am I on track for the interview?")).toEqual({ kind: "ON_TRACK", what: "interview" })
    expect(followUpIntent("how am I doing")).toEqual({ kind: "ON_TRACK", what: null })
  })

  it("a plan change only when a plan was just proposed", () => {
    expect(followUpIntent("make DSA 4 hours and add system design", true)).toEqual({ kind: "PLAN_CHANGE" })
    expect(followUpIntent("only weekends", true)).toEqual({ kind: "PLAN_CHANGE" })
    expect(followUpIntent("only weekends", false)).toBeNull()
  })

  it("ordinary messages are left to the AI", () => {
    for (const m of ["remind me to call mom at 6", "I want to learn guitar", "move to Bangalore next year is my plan", "feeling low today"]) {
      expect(followUpIntent(m), m).toBeNull()
    }
  })
})

describe("what the words mean", () => {
  it("hours without am/pm", () => {
    expect(resolveHour(9, "pm", 0)).toBe(21)
    expect(resolveHour(12, "am", 0)).toBe(0)
    expect(resolveHour(5, null, 600)).toBe(17) // "at 5" is evening
    expect(resolveHour(9, null, 8 * 60)).toBe(9) // 9 still ahead this morning
    expect(resolveHour(9, null, 10 * 60)).toBe(21) // 9 am has passed
    expect(resolveHour(8, null, 7 * 60, true)).toBe(20) // a habit at night
  })

  it("days ahead", () => {
    expect(daysAhead({ kind: "TOMORROW" }, 2)).toBe(1)
    expect(daysAhead({ kind: "WEEKDAY", weekday: 5 }, 2)).toBe(3) // Tue → Fri
    expect(daysAhead({ kind: "WEEKDAY", weekday: 2 }, 2)).toBe(7) // Tue → next Tue
    expect(daysAhead({ kind: "NEXT_WEEK" }, 3)).toBe(5) // Wed → Mon
    expect(daysAhead({ kind: "WEEKEND" }, 3)).toBe(3) // Wed → Sat
    expect(daysAhead({ kind: "WEEKEND" }, 6)).toBe(1) // Sat → Sun
  })

  it("'it' is the newest thing from the last few replies", () => {
    const turns = [
      { role: "assistant", refs: [{ type: "TASK" as const, id: "old" }] },
      { role: "user" },
      { role: "assistant", refs: [{ type: "HABIT" as const, id: "gym" }, { type: "TASK" as const, id: "call" }] },
      { role: "user" },
    ]
    expect(lastRef(turns, ["TASK", "HABIT"])?.id).toBe("call")
    expect(lastRef(turns, ["HABIT"])?.id).toBe("gym")
    expect(lastRef(turns, ["GOAL_PLAN"])).toBeNull()
  })

  it("names match loosely, never a coin toss", () => {
    const items = [{ title: "Gym session" }, { title: "Evening walk" }, { title: "Read 20 pages" }]
    expect(matchByTitle("gym", items)?.title).toBe("Gym session")
    expect(matchByTitle("walking", items)?.title).toBe("Evening walk")
    expect(matchByTitle("swim", items)).toBeNull()
  })
})
