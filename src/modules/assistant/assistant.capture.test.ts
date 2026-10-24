import { describe, expect, it } from "vitest"
import { repeatToRule, nextOccurrence, upcomingOccurrences, matchingTasks, isAmbiguousCompletion, localToUtc } from "./assistant.capture.js"

describe("repeat rules", () => {
  it("turns what the model says into an RRULE", () => {
    expect(repeatToRule({ freq: "weekly", days: ["Sunday"] })).toBe("FREQ=WEEKLY;BYDAY=SU")
    expect(repeatToRule({ freq: "WEEKLY", days: ["mon", "thu", "mon"] })).toBe("FREQ=WEEKLY;BYDAY=MO,TH")
    expect(repeatToRule({ freq: "DAILY" })).toBe("FREQ=DAILY")
  })
  it("ignores anything it does not understand", () => {
    expect(repeatToRule({ freq: "yearly" })).toBeNull()
    expect(repeatToRule(null)).toBeNull()
  })
})

describe("next occurrence", () => {
  const tz = "Asia/Kolkata"
  it("moves a weekly Sunday reminder to the next Sunday, same clock time", () => {
    const at = localToUtc("2026-10-11T09:00", tz)! // a Sunday
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=SU", at, tz)?.toISOString()).toBe(localToUtc("2026-10-18T09:00", tz)?.toISOString())
  })
  it("picks the nearest listed weekday", () => {
    const at = localToUtc("2026-10-12T08:00", tz)! // Monday
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO,TH", at, tz)?.toISOString()).toBe(localToUtc("2026-10-15T08:00", tz)?.toISOString())
  })
  it("daily and monthly", () => {
    const at = localToUtc("2026-10-31T20:00", tz)!
    expect(nextOccurrence("FREQ=DAILY", at, tz)?.toISOString()).toBe(localToUtc("2026-11-01T20:00", tz)?.toISOString())
    expect(nextOccurrence("FREQ=MONTHLY", at, tz)?.toISOString()).toBe(localToUtc("2026-11-30T20:00", tz)?.toISOString())
  })
})

describe("which to-do did they mean", () => {
  const tasks = [
    { id: "a", title: "Finish the report for client A" },
    { id: "b", title: "Send the weekly report" },
    { id: "c", title: "Update my resume" },
  ]
  it("asks when two to-dos match", () => {
    expect(isAmbiguousCompletion("done with the report", tasks, "a")?.map((t) => t.id).sort()).toEqual(["a", "b"])
  })
  it("does not ask when one clearly matches", () => {
    expect(isAmbiguousCompletion("done, I updated my resume", tasks, "c")).toBeNull()
  })
  it("an exact title picks one even when others share words", () => {
    expect(matchingTasks("Done: Send the weekly report", tasks).map((t) => t.id)).toEqual(["b"])
    expect(isAmbiguousCompletion("Done: Send the weekly report", tasks, "b")).toBeNull()
  })
})

describe("several times a day", () => {
  const tz = "Asia/Kolkata"
  const iso = (local: string) => localToUtc(local, tz)!.toISOString()

  it("expands 'every 2 hours from 9 to 21' in code", () => {
    expect(repeatToRule({ freq: "DAILY", everyHours: 2, from: "09:00", to: "21:00" })).toBe(
      "FREQ=DAILY;TIMES=09:00,11:00,13:00,15:00,17:00,19:00,21:00",
    )
    expect(repeatToRule({ freq: "WEEKLY", days: ["MO"], times: ["18:30", "08:00"] })).toBe("FREQ=WEEKLY;BYDAY=MO;TIMES=08:00,18:30")
    // One time is just a normal daily reminder.
    expect(repeatToRule({ freq: "DAILY", times: ["07:00"] })).toBe("FREQ=DAILY")
  })

  it("goes to the next time today, then to tomorrow's first", () => {
    const rule = "FREQ=DAILY;TIMES=09:00,13:00,21:00"
    expect(nextOccurrence(rule, localToUtc("2026-10-15T09:00", tz)!, tz)?.toISOString()).toBe(iso("2026-10-15T13:00"))
    expect(nextOccurrence(rule, localToUtc("2026-10-15T21:00", tz)!, tz)?.toISOString()).toBe(iso("2026-10-16T09:00"))
  })

  it("keeps to the listed weekdays", () => {
    const rule = "FREQ=WEEKLY;BYDAY=MO,FR;TIMES=08:00,18:00"
    // Monday 18:00 → Friday 08:00
    expect(nextOccurrence(rule, localToUtc("2026-10-12T18:00", tz)!, tz)?.toISOString()).toBe(iso("2026-10-16T08:00"))
  })
})

describe("upcoming occurrences", () => {
  const tz = "Asia/Kolkata"
  const iso = (local: string) => localToUtc(local, tz)!.toISOString()

  it("a daily reminder missed for days still has the next 7 times", () => {
    const at = localToUtc("2026-10-10T07:00", tz)! // never ticked
    const now = localToUtc("2026-10-15T10:00", tz)!
    const list = upcomingOccurrences("FREQ=DAILY", at, tz, now)
    expect(list).toHaveLength(7)
    expect(list[0]!.toISOString()).toBe(iso("2026-10-16T07:00"))
    expect(list[6]!.toISOString()).toBe(iso("2026-10-22T07:00"))
  })

  it("water every 2 hours: picks up from the next slot today", () => {
    const at = localToUtc("2026-10-14T09:00", tz)!
    const now = localToUtc("2026-10-15T12:10", tz)!
    const list = upcomingOccurrences("FREQ=DAILY;TIMES=09:00,11:00,13:00,15:00", at, tz, now, 5)
    expect(list.map((d) => d.toISOString())).toEqual([
      iso("2026-10-15T13:00"),
      iso("2026-10-15T15:00"),
      iso("2026-10-16T09:00"),
      iso("2026-10-16T11:00"),
      iso("2026-10-16T13:00"),
    ])
  })

  it("a reminder still ahead starts at its own time", () => {
    const at = localToUtc("2026-10-20T09:00", tz)!
    const list = upcomingOccurrences("FREQ=WEEKLY;BYDAY=TU", at, tz, localToUtc("2026-10-15T10:00", tz)!, 2)
    expect(list.map((d) => d.toISOString())).toEqual([iso("2026-10-20T09:00"), iso("2026-10-27T09:00")])
  })
})

describe("yearly repeats (birthdays)", () => {
  const tz = "Asia/Kolkata"
  it("comes back the same day next year at the same time", () => {
    const at = localToUtc("2026-03-12T09:00", tz)!
    expect(nextOccurrence("FREQ=YEARLY", at, tz)?.toISOString()).toBe(localToUtc("2027-03-12T09:00", tz)?.toISOString())
  })
  it("moves 29 February to the last day of February in a non-leap year", () => {
    const at = localToUtc("2028-02-29T09:00", tz)!
    expect(nextOccurrence("FREQ=YEARLY", at, tz)?.toISOString()).toBe(localToUtc("2029-02-28T09:00", tz)?.toISOString())
  })
  it("lists the next occurrences from a past start", () => {
    const at = localToUtc("2024-03-12T09:00", tz)!
    const next = upcomingOccurrences("FREQ=YEARLY", at, tz, new Date(Date.UTC(2026, 9, 24)), 2)
    expect(next.map((d) => d.toISOString())).toEqual([localToUtc("2027-03-12T09:00", tz)!.toISOString(), localToUtc("2028-03-12T09:00", tz)!.toISOString()])
  })
})
