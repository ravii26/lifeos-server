import { describe, expect, it } from "vitest"
import { agendaForDay, briefingBody, wrapUpBody, type AgendaDayInput } from "./agenda.rules.js"
import type { DayBlock, SuggestedBlock } from "./now.rules.js"

// The founder's office day: up at 7, office 10–20:30, sleep at midnight.
const officeDay: DayBlock[] = [
  { block: "MORNING", start: "07:00", end: "10:00", freeMinutes: 120 },
  { block: "OFFICE", start: "10:00", end: "20:30", freeMinutes: 0 },
  { block: "EVENING", start: "20:30", end: "23:00", freeMinutes: 120 },
  { block: "NIGHT", start: "23:00", end: "24:00", freeMinutes: 30 },
]

const suggested: SuggestedBlock[] = [
  {
    block: "MORNING", start: "07:00", end: "10:00", freeMinutes: 120,
    items: [{ sourceType: "PROJECT", sourceId: "dsa", title: "DSA", minutes: 45, count: null, why: "Keeps you on pace for 6 h this week." }],
  },
  {
    block: "EVENING", start: "20:30", end: "23:00", freeMinutes: 120,
    items: [
      { sourceType: "HABIT", sourceId: "gym", title: "Gym", minutes: 15, count: null, why: "2 of 4 this week." },
      { sourceType: "HABIT", sourceId: "read", title: "Read", minutes: 20, count: null, why: "After dinner." },
    ],
  },
]

const day = (over: Partial<AgendaDayInput> = {}): AgendaDayInput => ({
  dayKey: "2026-10-20",
  weekday: 2,
  nowMin: 6 * 60,
  isToday: true,
  blocks: officeDay,
  suggested,
  mode: "NORMAL",
  level: "NORMAL",
  busyUntilMin: null,
  wrapUpAt: null,
  due: [{ title: "Report", when: "tomorrow" }],
  doneToday: [],
  leftToday: ["English", "Read"],
  week: [],
  ...over,
})

describe("the proactive agenda", () => {
  it("an office day: briefing at wake, an evening nudge, wrap-up before sleep", () => {
    const a = agendaForDay(day())
    expect(a.map((i) => `${i.kind}@${i.atMin}`)).toEqual(["BRIEFING@420", "SLOT@1230", "WRAP_UP@1410"])
    expect(a[1]).toMatchObject({ title: "Evening: Gym 15 min", sourceId: "gym", actions: [{ id: "DONE" }, { id: "SKIP" }] })
    expect(a[1]!.body).toContain("Then: Read 20 min.")
  })

  it("the briefing says the day in a few lines", () => {
    expect(briefingBody(day())).toBe("Office 10 am–8:30 pm.\nBefore office: DSA 45 min.\nAfter: Gym 15 min, Read 20 min.\nDue tomorrow: Report.")
  })

  it("the morning slot is folded into the briefing, not sent twice", () => {
    expect(agendaForDay(day()).filter((i) => i.key.endsWith("SLOT:MORNING"))).toHaveLength(0)
  })

  it("nothing in the person's night: quiet hours follow their own sleep and wake", () => {
    const late = agendaForDay(day({ wrapUpAt: "01:30" }))
    expect(late.every((i) => i.atMin >= 420 && i.atMin < 1440)).toBe(true)
    expect(late.find((i) => i.kind === "WRAP_UP")!.atMin).toBe(1410) // their own time was outside, so the default
  })

  it("their own evening time is used for the wrap-up when it's in their day", () => {
    expect(agendaForDay(day({ wrapUpAt: "22:00" })).find((i) => i.kind === "WRAP_UP")!.atMin).toBe(22 * 60)
  })

  it("only what is still ahead", () => {
    expect(agendaForDay(day({ nowMin: 21 * 60 })).map((i) => i.kind)).toEqual(["WRAP_UP"])
  })

  it("Quieter: briefing and wrap-up only; Silent: nothing", () => {
    expect(agendaForDay(day({ level: "QUIETER" })).map((i) => i.kind)).toEqual(["BRIEFING", "WRAP_UP"])
    expect(agendaForDay(day({ level: "SILENT" }))).toEqual([])
  })

  it("sick, travelling or on holiday: nothing; busy: no slot nudges", () => {
    for (const mode of ["SICK", "TRAVEL", "HOLIDAY"] as const) expect(agendaForDay(day({ mode }))).toEqual([])
    const busy = agendaForDay(day({ mode: "BUSY" }))
    expect(busy.map((i) => i.kind)).toEqual(["BRIEFING", "WRAP_UP"])
    expect(busy[0]!.body).toContain("only the smallest versions")
  })

  it("in a meeting till 9 pm: the 8:30 pm nudge is not sent", () => {
    expect(agendaForDay(day({ busyUntilMin: 21 * 60 })).some((i) => i.kind === "SLOT")).toBe(false)
  })

  it("wrap-up offers to move what's left, and never blames", () => {
    expect(wrapUpBody(day())).toEqual({ body: "Nothing ticked today, and that's okay. Still open: English, Read. Move them to tomorrow?", canMove: true })
    expect(wrapUpBody(day({ doneToday: ["DSA", "Gym"], leftToday: [] }))).toEqual({ body: "Done today: DSA, Gym. Nothing left. Rest well.", canMove: false })
    expect(wrapUpBody(day({ isToday: false })).canMove).toBe(false)
  })

  it("Sunday adds the week review before the wrap-up", () => {
    const sunday = agendaForDay(day({ weekday: 0, week: ["DSA: 5 of 6 h", "Applications: 8 of 10"] }))
    const review = sunday.find((i) => i.kind === "WEEKLY_REVIEW")!
    expect(review.atMin).toBe(1410 - 60)
    expect(review.body).toBe("DSA: 5 of 6 h\nApplications: 8 of 10\nTap to plan next week.")
    expect(sunday[0]!.title).toBe("Your weekend day")
  })

  it("an empty day still gets a briefing that invites, not nags", () => {
    expect(briefingBody(day({ suggested: [], due: [] }))).toBe("Office 10 am–8:30 pm.\nNothing planned yet. Tell me what matters today.")
  })
})
