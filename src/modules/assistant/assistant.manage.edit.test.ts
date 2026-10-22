import { describe, expect, it } from "vitest"
import { areaIntent, editChoiceText, editIntent, editValueText } from "./assistant.manage.edit.js"
import { manageIntent } from "./assistant.manage.js"

describe("changing a thing by name", () => {
  it("time (needs am/pm or a colon)", () => {
    expect(editIntent("set the gym habit to 7 am")).toMatchObject({ kind: "HABIT", name: "gym", edit: { field: "TIME", hour: 7, minute: 0, ampm: "am" } })
    expect(editIntent("change call mom reminder to 8:30 pm")).toMatchObject({ kind: null, name: "call mom", edit: { field: "TIME", hour: 8, minute: 30, ampm: "pm" } })
    expect(editIntent("move the water habit to 21:00")).toMatchObject({ kind: "HABIT", name: "water", edit: { field: "TIME", hour: 21, minute: 0, ampm: null } })
    expect(editIntent("set gym to 7")).toBeNull() // a bare number is not a time
  })
  it("size", () => {
    expect(editIntent("make passport 45 min")).toMatchObject({ name: "passport", edit: { field: "SIZE", minutes: 45 } })
    expect(editIntent("set the guitar goal sessions to 25 minutes")).toMatchObject({ kind: "PROJECT", name: "guitar", edit: { field: "SIZE", minutes: 25 } })
    expect(editIntent("make reading habit 1.5 hours")).toMatchObject({ kind: "HABIT", name: "reading", edit: { field: "SIZE", minutes: 90 } })
  })
  it("priority", () => {
    expect(editIntent("make passport high priority")).toMatchObject({ name: "passport", edit: { field: "PRIORITY", level: "HIGH" } })
    expect(editIntent("set the priority of the guitar goal to low")).toMatchObject({ kind: "PROJECT", edit: { field: "PRIORITY", level: "LOW" } })
    expect(editIntent("mark passport as urgent priority")).toMatchObject({ edit: { field: "PRIORITY", level: "CRITICAL" } })
    expect(editIntent("make passport high")).toBeNull() // needs the word priority
  })
  it("a day, a weekday, a date", () => {
    expect(editIntent("move passport to friday")).toMatchObject({ name: "passport", edit: { field: "WHEN", when: { kind: "WEEKDAY", weekday: 5 } } })
    expect(editIntent("push the report to tomorrow")).toMatchObject({ edit: { field: "WHEN", when: { kind: "TOMORROW" } } })
    expect(editIntent("set the guitar deadline to 30 nov")).toMatchObject({ kind: null, name: "guitar", edit: { field: "DATE", day: 30, month: 11, year: null } })
    expect(editIntent("set passport due date to December 5 2027")).toMatchObject({ edit: { field: "DATE", day: 5, month: 12, year: 2027 } })
    expect(editIntent("set the exam to 2027-03-14")).toMatchObject({ edit: { field: "DATE", day: 14, month: 3, year: 2027 } })
  })
  it("days of a habit", () => {
    expect(editIntent("make gym habit mon wed fri")).toBeNull() // needs to/on/for
    expect(editIntent("set the gym habit to mon wed fri")).toMatchObject({ kind: "HABIT", name: "gym", edit: { field: "DAYS", days: ["MON", "WED", "FRI"] } })
    expect(editIntent("change reading habit to weekdays")).toMatchObject({ edit: { field: "DAYS", days: ["MON", "TUE", "WED", "THU", "FRI"] } })
    expect(editIntent("set water to every day")).toMatchObject({ edit: { field: "DAYS", days: [] } })
    expect(editIntent("set gym habit on tuesday and thursday")).toMatchObject({ edit: { field: "DAYS", days: ["TUE", "THU"] } })
  })
  it("leaves other sentences alone", () => {
    expect(editIntent("set it to 7 am")).toBeNull() // the follow-up handles "it"
    expect(editIntent("make that 30 min")).toBeNull()
    expect(editIntent("remind me to set an alarm at 7 am")).toBeNull()
    expect(editIntent("move the meeting from 3 pm to 4 pm")).toBeNull() // contains "from"
    expect(editIntent("what time is it")).toBeNull()
  })
  it("a 'which one?' choice reads back the same", () => {
    const edits = ["set the gym habit to 7 am", "make passport 45 min", "make passport high priority", "move passport to friday", "set the guitar deadline to 30 nov", "set the gym habit to mon wed fri"]
    for (const text of edits) {
      const ei = editIntent(text)!
      const again = editIntent(editChoiceText({ id: "1", kind: "TASK", title: "Pack gym bag" }, ei.edit))
      expect(again, text).toMatchObject({ kind: "TASK", name: "Pack gym bag", edit: ei.edit })
      expect(editValueText(ei.edit).length).toBeGreaterThan(0)
    }
  })
  it("does not collide with removing, pausing or renaming", () => {
    expect(manageIntent("make passport 45 min")).toBeNull()
    expect(manageIntent("set the gym habit to 7 am")).toBeNull()
    expect(editIntent("rename passport to renew passport")).toBeNull()
    expect(editIntent("delete my gym habit")).toBeNull()
  })
})

describe("areas", () => {
  it("adds one", () => {
    expect(areaIntent("add an area called music")).toEqual({ op: "CREATE", name: "music" })
    expect(areaIntent("create a new area for Money")).toEqual({ op: "CREATE", name: "Money" })
    expect(areaIntent("add music as an area")).toEqual({ op: "CREATE", name: "music" })
  })
  it("changes how much of your time it gets", () => {
    expect(areaIntent("make health my main area")).toEqual({ op: "TIER", name: "health", tier: "MAIN", confirmed: false })
    expect(areaIntent("make music secondary")).toEqual({ op: "TIER", name: "music", tier: "SECONDARY", confirmed: false })
    expect(areaIntent("move music to later")).toEqual({ op: "TIER", name: "music", tier: "LATER", confirmed: false })
    expect(areaIntent("set the money area to maintain")).toEqual({ op: "TIER", name: "money", tier: "MAINTAIN", confirmed: false })
    expect(areaIntent("Yes, make Health my main area")).toEqual({ op: "TIER", name: "Health", tier: "MAIN", confirmed: true })
  })
  it("ignores sentences that are not about areas", () => {
    expect(areaIntent("remind me to call mom")).toBeNull()
    expect(areaIntent("make it later")).toBeNull()
    expect(areaIntent("add milk to my list")).toBeNull()
  })
})
