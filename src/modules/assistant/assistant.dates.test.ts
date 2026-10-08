import { describe, expect, it } from "vitest"
import { clauseFor, correctActionDates, correctWeekdayDate, endOfNextWeek, namedWeekday, nextWeekdayKey, relativeDate } from "./assistant.dates.js"

// 2026-10-08 is a Thursday.
const TODAY = "2026-10-08"

describe("weekday names", () => {
  it("finds exactly one named weekday", () => {
    expect(namedWeekday("Project A: API due Thursday, high priority")).toBe(4)
    expect(namedWeekday("send it by fri")).toBe(5)
  })
  it("ignores messages with none, several, or today / tomorrow", () => {
    expect(namedWeekday("update my resume this week")).toBeNull()
    expect(namedWeekday("call on Monday or Tuesday")).toBeNull()
    expect(namedWeekday("do it tomorrow, not Friday")).toBeNull()
  })
  it("does not read weekday names inside other words", () => {
    expect(namedWeekday("the sunny side, a monster task")).toBeNull()
  })
})

describe("the next occurrence", () => {
  it("is strictly after today", () => {
    expect(nextWeekdayKey(4, TODAY)).toBe("2026-10-15")
    expect(nextWeekdayKey(5, TODAY)).toBe("2026-10-09")
    expect(nextWeekdayKey(0, TODAY)).toBe("2026-10-11")
  })
})

describe("correcting the model's date", () => {
  it("moves a wrong weekday to the named one", () => {
    expect(correctWeekdayDate("2026-10-09", "API due Thursday", TODAY)).toBe("2026-10-15")
  })
  it("keeps a date that already matches", () => {
    expect(correctWeekdayDate("2026-10-15", "API due Thursday", TODAY)).toBe("2026-10-15")
  })
  it("leaves other dates alone", () => {
    expect(correctWeekdayDate("2026-10-09", "finish it soon", TODAY)).toBe("2026-10-09")
    expect(correctWeekdayDate(null, "due Thursday", TODAY)).toBeNull()
  })
})

describe("per action", () => {
  const text = "Project A: API due Thursday, high priority. Project B: UI, next week"
  it("judges each project against its own sentence", () => {
    expect(clauseFor(text, "API")).toBe("Project A: API due Thursday, high priority")
    expect(clauseFor(text, "UI")).toBe("Project B: UI, next week")
  })
  it("fixes the Thursday project and gives the next-week project a date, leaving the other alone", () => {
    const api = correctActionDates({ type: "ADD_PROJECT", title: "API", deadline: "2026-10-09", tasks: [{ title: "Build API", due: "2026-10-09" }] }, text, TODAY)
    expect(api.deadline).toBe("2026-10-15")
    expect(api.tasks![0]!.due).toBe("2026-10-15")
    const ui = correctActionDates({ type: "ADD_PROJECT", title: "UI", deadline: null as string | null, tasks: [{ title: "Build UI" } as { title: string; due?: string | null }] }, text, TODAY)
    expect(ui.deadline).toBe(endOfNextWeek(TODAY))
    expect(ui.deadline).toBe("2026-10-16")
    expect(ui.tasks![0]!.due).toBe("2026-10-16")
  })
  it("keeps the model's date when no sentence clearly belongs to the action", () => {
    expect(correctActionDates({ type: "ADD_TASK", title: "Pay rent", due: "2026-10-09" }, "Call mom Thursday. Email Raj Friday.", TODAY).due).toBe("2026-10-09")
  })
  it("ignores other action types", () => {
    expect(correctActionDates({ type: "SET_REMINDER", due: "2026-10-09" }, "due Thursday", TODAY).due).toBe("2026-10-09")
  })
})

describe("relative dates are arithmetic", () => {
  it("in N days / weeks / months / years", () => {
    expect(relativeDate("I want to switch jobs in 6 months", TODAY)).toBe("2027-04-08")
    expect(relativeDate("finish it in two weeks", TODAY)).toBe("2026-10-22")
    expect(relativeDate("back in 3 days", TODAY)).toBe("2026-10-11")
    expect(relativeDate("run a marathon in a year", TODAY)).toBe("2027-10-08")
  })
  it("clamps to the end of a shorter month", () => {
    expect(relativeDate("in 1 month", "2026-01-31")).toBe("2026-02-28")
  })
  it("ignores text without a relative phrase, or one that is not a date", () => {
    expect(relativeDate("update my resume this week", TODAY)).toBeNull()
    expect(relativeDate("call mom in the morning", TODAY)).toBeNull()
  })
  it("overrides a wrong model date for a goal", () => {
    const g = correctActionDates({ type: "ADD_PROJECT", title: "Switch jobs", deadline: "2026-04-08" as string | null }, "I want to switch jobs in 6 months", TODAY)
    expect(g.deadline).toBe("2027-04-08")
  })
  it("drops a date in the past unless the person said it is overdue", () => {
    expect(correctActionDates({ type: "ADD_TASK", title: "Pay rent", due: "2025-10-09" as string | null }, "pay the rent", TODAY).due).toBeNull()
    expect(correctActionDates({ type: "ADD_TASK", title: "Pay rent", due: "2026-10-01" as string | null }, "pay the rent, it's overdue", TODAY).due).toBe("2026-10-01")
  })
})
