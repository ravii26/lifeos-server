import { describe, expect, it } from "vitest"
import {
  adviseNow,
  deadlineFocus,
  formatAmount,
  nextSaturdayKey,
  scoreItem,
  targetPace,
  targetSession,
  whyFromReasons,
  type ScoreInput,
  type WeeklyTarget,
} from "./brain.rules.js"
import { rightNow, suggestDay, type DayBlock, type NowCandidate } from "./now.rules.js"

const target = (over: Partial<WeeklyTarget> = {}): WeeklyTarget => ({
  projectId: "p1",
  title: "DSA",
  unit: "min",
  countUnit: null,
  target: 360, // 6 h a week
  doneThisWeek: 0,
  doneToday: 0,
  daysElapsed: 3, // Thursday
  sessionMinutes: null,
  block: "MORNING",
  tier: "MAIN",
  areaName: "Career",
  deadlineKey: null,
  goalTitle: null,
  ...over,
})

describe("weekly targets", () => {
  it("knows how far behind an even pace you are", () => {
    // By Thursday an even pace is 3/7 of 6 h ≈ 154 min; 60 done → ~94 behind.
    const p = targetPace(target({ doneThisWeek: 60 }))
    expect(Math.round(p.expectedByToday)).toBe(154)
    expect(Math.round(p.behind)).toBe(94)
    expect(p.daysLeft).toBe(4)
    expect(p.remaining).toBe(300)
  })

  it("sizes today's session from what is left, 15 to 60 minutes", () => {
    expect(targetSession(target({ doneThisWeek: 60 }))).toMatchObject({ minutes: 60, count: null }) // 300 left / 4 days = 75 → 60
    expect(targetSession(target({ target: 60, daysElapsed: 0 }))?.minutes).toBe(15) // 60 / 7 ≈ 9 → 15
    expect(targetSession(target({ sessionMinutes: 45, doneThisWeek: 60 }))?.minutes).toBe(45)
  })

  it("counted targets say how many: apply to 2 jobs", () => {
    const s = targetSession(target({ title: "Apply to jobs", unit: "count", countUnit: "applications", target: 10, daysElapsed: 2, doneThisWeek: 1 }))
    // 9 left over 5 days → 2 today.
    expect(s).toMatchObject({ count: 2, title: "Apply to jobs: 2 applications" })
  })

  it("doesn't ask for more once today's share is done, or the week is done", () => {
    expect(targetSession(target({ doneThisWeek: 150, doneToday: 90 }))).toBeNull()
    expect(targetSession(target({ doneThisWeek: 360 }))).toBeNull()
  })

  it("formats amounts plainly", () => {
    expect(formatAmount(120, "min", null)).toBe("2 h")
    expect(formatAmount(45, "min", null)).toBe("45 min")
    expect(formatAmount(1, "count", "applications")).toBe("1 application")
  })
})

const base: ScoreInput = {
  tier: "MAIN",
  dueKey: null,
  deadlineKey: null,
  goalTitle: null,
  areaName: "Career",
  areaIdleDays: null,
  anchorText: null,
  blockMatch: false,
  minutes: 30,
  available: 30,
  skippedToday: false,
}

describe("scoring with reasons", () => {
  const today = "2026-10-15"

  it("behind-pace and a near deadline both count, and both become the why", () => {
    const s = scoreItem(
      { ...base, goalTitle: "Interview prep", deadlineKey: "2026-11-26", target: { behind: 120, target: 360, unit: "min", countUnit: null } },
      today,
    )
    expect(whyFromReasons(s.reasons, "")).toBe("You're 2 h behind this week, and interview prep is in 6 weeks.")
  })

  it("a Main item behind pace beats a Secondary one that's on pace", () => {
    const behind = scoreItem({ ...base, target: { behind: 90, target: 360, unit: "min", countUnit: null } }, today).score
    const onPace = scoreItem({ ...base, tier: "SECONDARY", target: { behind: -20, target: 120, unit: "min", countUnit: null } }, today).score
    expect(behind).toBeGreaterThan(onPace)
  })

  it("'Not now' earlier today pushes an item down", () => {
    expect(scoreItem({ ...base, skippedToday: true }, today).score).toBeLessThan(scoreItem({ ...base, tier: "MAINTAIN" }, today).score)
  })

  it("an area left alone for a week gets a nudge, with the reason", () => {
    const s = scoreItem({ ...base, areaName: "Health", areaIdleDays: 6 }, today)
    expect(s.reasons.map((r) => r.text)).toContain("Health hasn't had any time for 6 days")
  })

  it("due tomorrow is said plainly", () => {
    expect(whyFromReasons(scoreItem({ ...base, dueKey: "2026-10-16" }, today).reasons, "")).toBe("It's due tomorrow.")
  })
})

describe("tight-deadline takeover", () => {
  const today = "2026-10-15"
  it("a to-do due tomorrow that needs most of today's free time takes over", () => {
    const f = deadlineFocus(
      [
        { sourceId: "t1", sourceType: "TASK", title: "Finish report", minutes: 120, dueKey: "2026-10-16" },
        { sourceId: "t2", sourceType: "TASK", title: "Read", minutes: 20, dueKey: null },
      ],
      150,
      today,
    )
    expect(f?.sourceId).toBe("t1")
  })
  it("a small one due tomorrow doesn't take the whole day", () => {
    expect(deadlineFocus([{ sourceId: "t1", sourceType: "TASK", title: "Pay bill", minutes: 10, dueKey: "2026-10-16" }], 150, today)).toBeNull()
  })
})

describe("advice", () => {
  const blocks: DayBlock[] = [
    { block: "EVENING", start: "20:30", end: "22:30", freeMinutes: 120 },
    { block: "NIGHT", start: "22:30", end: "23:30", freeMinutes: 30 },
  ]
  const top = { sourceType: "PROJECT" as const, sourceId: "p1", title: "DSA", minutes: 2, fullMinutes: 45, smaller: true }

  it("late at night, a big task is 'not now', with the smallest version on offer", () => {
    const a = adviseNow({ nowMin: 23 * 60, blocks, block: "NIGHT", top, skips14d: 0, savesToday: 0, savesActedToday: 0 })
    expect(a?.kind).toBe("LATE_NIGHT")
    expect(a?.actions.map((x) => x.choice)).toEqual(["MINIMUM_NOW", "TOMORROW", "ANYWAY"])
  })

  it("something put off 3 times gets three honest options", () => {
    const a = adviseNow({ nowMin: 21 * 60, blocks, block: "EVENING", top, skips14d: 3, savesToday: 0, savesActedToday: 0 })
    expect(a?.kind).toBe("KEEPS_SLIPPING")
    expect(a?.actions.map((x) => x.choice)).toEqual(["SMALLER", "WEEKEND", "LET_GO"])
  })

  it("saves piling up with nothing done", () => {
    expect(adviseNow({ nowMin: 21 * 60, blocks, block: "EVENING", top: null, skips14d: 0, savesToday: 6, savesActedToday: 0 })?.kind).toBe("SAVES_PILING")
    expect(adviseNow({ nowMin: 21 * 60, blocks, block: "EVENING", top: null, skips14d: 0, savesToday: 6, savesActedToday: 1 })).toBeNull()
  })

  it("the next Saturday", () => {
    expect(nextSaturdayKey("2026-10-15")).toBe("2026-10-17") // Thursday → Saturday
    expect(nextSaturdayKey("2026-10-17")).toBe("2026-10-24") // Saturday → next Saturday
  })
})

describe("rightNow with the brain", () => {
  const blocks: DayBlock[] = [
    { block: "MORNING", start: "07:00", end: "10:00", freeMinutes: 120 },
    { block: "OFFICE", start: "10:00", end: "20:30", freeMinutes: 0 },
    { block: "EVENING", start: "20:30", end: "22:30", freeMinutes: 120 },
  ]
  const cand = (over: Partial<NowCandidate>): NowCandidate => ({
    sourceType: "TASK",
    sourceId: "x",
    title: "x",
    block: null,
    sizeMinutes: 30,
    minimum: null,
    tier: "MAIN",
    dueKey: null,
    order: 0,
    areaName: "Career",
    goalTitle: null,
    goalWhy: null,
    ...over,
  })
  const input = (candidates: NowCandidate[], nowMin = 7 * 60 + 30, freeToday = 240) => ({
    nowMin,
    todayKey: "2026-10-15",
    weekday: 4,
    dayOfMonth: 15,
    blocks,
    mode: "NORMAL" as const,
    minutes: null,
    gapDays: 0,
    freeToday,
    candidates,
  })

  it("picks the weekly target that's behind, and says why", () => {
    const r = rightNow(
      input([
        cand({ sourceType: "PROJECT", sourceId: "dsa", title: "DSA", block: "MORNING", sizeMinutes: 45, target: { behind: 120, target: 360, unit: "min", countUnit: null }, goalTitle: "Interview prep", deadlineKey: "2026-11-26" }),
        cand({ sourceId: "read", title: "Read a chapter", tier: "SECONDARY" }),
      ]),
    )
    expect(r.options[0]?.sourceId).toBe("dsa")
    expect(r.options[0]?.why).toMatch(/2 h behind this week/)
  })

  it("a report due tomorrow that needs most of the day takes over and names what waits", () => {
    const r = rightNow(
      input([
        cand({ sourceId: "rep", title: "Finish report", sizeMinutes: 180, dueKey: "2026-10-16" }),
        cand({ sourceType: "PROJECT", sourceId: "dsa", title: "DSA", block: "MORNING", sizeMinutes: 45, target: { behind: 120, target: 360, unit: "min", countUnit: null } }),
      ]),
    )
    expect(r.focus?.sourceId).toBe("rep")
    expect(r.options.map((o) => o.sourceId)).toEqual(["rep"])
    expect(r.message).toMatch(/Finish report is due tomorrow.*DSA can wait/)
  })

  it("the day plan fills free parts of the day, each thing once, never office hours", () => {
    const day = suggestDay({
      ...input([
        cand({ sourceType: "PROJECT", sourceId: "dsa", title: "DSA", block: "MORNING", sizeMinutes: 45, target: { behind: 120, target: 360, unit: "min", countUnit: null } }),
        cand({ sourceId: "read", title: "Read", sizeMinutes: 20, tier: "SECONDARY" }),
        cand({ sourceId: "gym", title: "Gym", block: "EVENING", sizeMinutes: 60 }),
        cand({ sourceId: "later", title: "Someday", tier: "LATER" }),
      ]),
    })
    expect(day.map((b) => b.block)).toEqual(["MORNING", "EVENING"])
    expect(day[0]!.items.map((i) => i.sourceId)).toEqual(["dsa", "read"])
    expect(day[1]!.items.map((i) => i.sourceId)).toEqual(["gym"])
    expect(day[0]!.items[0]!.why).toMatch(/behind this week/)
  })

  it("after 'Not now' the next best comes first", () => {
    const r = rightNow(
      input([
        cand({ sourceId: "a", title: "A", skippedToday: true }),
        cand({ sourceId: "b", title: "B", tier: "SECONDARY" }),
      ]),
    )
    expect(r.options[0]?.sourceId).toBe("b")
  })
})
