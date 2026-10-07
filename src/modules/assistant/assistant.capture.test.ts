import { describe, expect, it } from "vitest"
import { repeatToRule, nextOccurrence, matchingTasks, isAmbiguousCompletion, localToUtc } from "./assistant.capture.js"

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
