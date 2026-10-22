import { describe, expect, it } from "vitest"
import { repeatWord, showIntent } from "./assistant.manage.show.js"
import { manageIntent } from "./assistant.manage.js"
import { editIntent } from "./assistant.manage.edit.js"

describe("show me", () => {
  it("each kind, in the ways people ask", () => {
    expect(showIntent("show my habits")).toEqual({ what: "LIVE", kind: "HABIT" })
    expect(showIntent("Show me my reminders")).toEqual({ what: "LIVE", kind: "REMINDER" })
    expect(showIntent("list all my to-dos")).toEqual({ what: "LIVE", kind: "TASK" })
    expect(showIntent("list the tasks")).toEqual({ what: "LIVE", kind: "TASK" })
    expect(showIntent("what are my goals?")).toEqual({ what: "LIVE", kind: "PROJECT" })
    expect(showIntent("what habits do I have")).toEqual({ what: "LIVE", kind: "HABIT" })
    expect(showIntent("what reminders do I have?")).toEqual({ what: "LIVE", kind: "REMINDER" })
    expect(showIntent("show my areas")).toEqual({ what: "LIVE", kind: "AREA" })
    expect(showIntent("my notes")).toEqual({ what: "LIVE", kind: "NOTE" })
    expect(showIntent("what's on my list")).toEqual({ what: "LIVE", kind: "TASK" })
  })
  it("what was removed or paused", () => {
    expect(showIntent("what did I remove?")).toEqual({ what: "REMOVED" })
    expect(showIntent("what did I delete recently")).toEqual({ what: "REMOVED" })
    expect(showIntent("show my removed things")).toEqual({ what: "REMOVED" })
    expect(showIntent("what can I bring back")).toEqual({ what: "REMOVED" })
  })
  it("leaves other sentences alone", () => {
    expect(showIntent("show me notes about caching")).toBeNull() // a search, not a list
    expect(showIntent("what's my day")).toBeNull()
    expect(showIntent("show my plan")).toBeNull()
    expect(showIntent("remind me to show my habits to Rahul")).toBeNull()
    expect(showIntent("I want to list my goals for the year and think about them for a long time")).toBeNull()
  })
  it("does not collide with the other commands", () => {
    for (const t of ["show my habits", "what reminders do I have", "what did I remove"]) {
      expect(manageIntent(t), t).toBeNull()
      expect(editIntent(t), t).toBeNull()
    }
  })
  it("says how a reminder repeats", () => {
    expect(repeatWord("FREQ=WEEKLY;BYDAY=SU")).toBe("repeats weekly")
    expect(repeatWord("FREQ=DAILY;TIMES=09:00")).toBe("repeats daily")
    expect(repeatWord(null)).toBeNull()
  })
})

describe("quoted rename (what the list's Rename button sends)", () => {
  it("a title with 'to' in it is kept whole", () => {
    expect(manageIntent('Rename habit: "Walk to work" to Walk')).toMatchObject({ verb: "RENAME", kind: "HABIT", name: "Walk to work", to: "Walk" })
    expect(manageIntent("rename passport to renew passport")).toMatchObject({ name: "passport", to: "renew passport" })
  })
})

describe("quoted titles (what the list buttons and the choices send)", () => {
  it("a title containing from, to or as is one name", () => {
    expect(manageIntent('Remove habit: "Learn from mistakes"')).toMatchObject({ verb: "REMOVE", kind: "HABIT", name: "Learn from mistakes" })
    expect(manageIntent('Pause goal: "Move to Pune"')).toMatchObject({ verb: "PAUSE", kind: "PROJECT", name: "Move to Pune" })
    expect(manageIntent('Bring back to-do: "Recover from cold"')).toMatchObject({ verb: "RESTORE", kind: "TASK", name: "Recover from cold" })
    expect(editIntent('Set to-do: "Walk to work" to tomorrow')).toMatchObject({ kind: "TASK", name: "Walk to work", edit: { field: "WHEN" } })
    expect(editIntent('Set habit: "Read from a book" to 7 am')).toMatchObject({ kind: "HABIT", name: "Read from a book", edit: { field: "TIME", hour: 7 } })
  })
  it("an unquoted 'from' is still left to the AI", () => {
    expect(manageIntent("remove sugar from my diet note")).toBeNull()
    expect(editIntent("move the meeting from 3 pm to 4 pm")).toBeNull()
  })
})
