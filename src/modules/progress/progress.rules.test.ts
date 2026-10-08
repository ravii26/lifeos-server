import { describe, expect, it } from "vitest"
import { habitLife, metricStand, milestoneStand, monthPhrase, practiceStand, workStand, type HabitLifeInput } from "./progress.rules.js"

const d = (s: string) => new Date(`${s}T12:00:00Z`)
const DAY = 86_400_000

describe("job switch (milestone project)", () => {
  const ms = [
    { title: "Resume ready", order: 0, target: null, doneAt: d("2026-09-10"), progress: 0 },
    { title: "50 DSA problems", order: 1, target: 50, doneAt: null, progress: 23 },
    { title: "5 system design topics", order: 2, target: 5, doneAt: null, progress: 0 },
    { title: "5 mock interviews", order: 3, target: 5, doneAt: null, progress: 0 },
    { title: "20 applications", order: 4, target: 20, doneAt: null, progress: 0 },
  ]
  it("shows stage, percent and what is next", () => {
    const s = milestoneStand(ms, { now: d("2026-10-20"), createdAt: d("2026-09-01"), deadline: d("2027-03-15") })
    expect(s.stage).toBe(2)
    expect(s.total).toBe(5)
    expect(s.percent).toBe(29)
    expect(s.current?.remaining).toBe(27)
    expect(s.message).toMatch(/^Stage 2 of 5 · 29% · next: 27 more DSA problems/)
  })
  it("says on pace for the deadline when the pace holds, otherwise the honest forecast", () => {
    const ahead = milestoneStand(ms, { now: d("2026-10-20"), createdAt: d("2026-09-01"), deadline: d("2027-03-15") })
    expect(ahead.pace).toBe("AHEAD")
    expect(ahead.message).toMatch(/on pace for mid-March/)
    const behind = milestoneStand(ms, { now: d("2027-02-01"), createdAt: d("2026-09-01"), deadline: d("2027-03-15") })
    expect(behind.pace).toBe("BEHIND")
    expect(behind.message).toMatch(/at this pace: /)
  })
  it("auto-completes a counted milestone once its target is logged", () => {
    const done = ms.map((m) => (m.title.startsWith("50") ? { ...m, progress: 50 } : m))
    expect(milestoneStand(done, { now: d("2026-10-20"), createdAt: d("2026-09-01"), deadline: null }).stage).toBe(3)
  })
})

describe("weight (outcome project)", () => {
  const metric = { name: "Weight", unit: "kg", startValue: 85, targetValue: 70 }
  const now = d("2026-10-07")
  const weekly = (vals: number[]) => vals.map((value, i) => ({ value, at: new Date(now.getTime() - (vals.length - 1 - i) * 7 * DAY) }))
  it("shows the trend and a forecast date", () => {
    const s = metricStand(metric, weekly([85, 84.4, 83.8, 83.2]), now)
    expect(s.trend).toBe("TOWARD")
    expect(s.percent).toBe(12)
    expect(s.weeklyChange).toBeCloseTo(-0.6, 1)
    expect(s.forecast).not.toBeNull()
    const weeks = (s.forecast!.getTime() - now.getTime()) / (7 * DAY)
    expect(weeks).toBeGreaterThan(20)
    expect(weeks).toBeLessThan(24)
    expect(s.message).toMatch(/Weight: 85 → 83\.2 → 70 kg · 12%/)
  })
  it("a stall gets two options and no blame", () => {
    const s = metricStand(metric, weekly([83.2, 83.1, 83.2, 83.1]), now)
    expect(s.trend).toBe("STALLED")
    expect(s.options).toHaveLength(2)
    expect(s.message).not.toMatch(/fail|lazy|miss|should/i)
  })
  it("too few entries: no false forecast", () => {
    expect(metricStand(metric, weekly([85, 84.5]), now).trend).toBe("TOO_EARLY")
  })
  it("weight going the wrong way is honest, not a forecast", () => {
    expect(metricStand(metric, weekly([83, 83.6, 84.2, 84.8]), now).trend).toBe("AWAY")
  })
})

describe("English (practice project)", () => {
  it("shows this week against the target, weeks on target, and total hours", () => {
    const s = practiceStand(150, [160, 90, 150, 170, 140, 150, 155, 150, 75], 20 * 60)
    expect(s.thisWeek).toBe(75)
    expect(s.weeksOnTarget).toBe(6)
    expect(s.weeksCounted).toBe(8)
    expect(s.message).toBe("This week: 75 of 150 min · 6 of the last 8 weeks on target · 20 h in total")
  })
})

describe("work project", () => {
  it("on track, tight, at risk, late, done", () => {
    expect(workStand(4, 5, "2026-10-10", "2026-10-07", 7).risk).toBe("ON_TRACK")
    expect(workStand(2, 5, "2026-10-10", "2026-10-07", 7).risk).toBe("TIGHT")
    expect(workStand(0, 6, "2026-10-09", "2026-10-07", 3).risk).toBe("AT_RISK")
    expect(workStand(1, 5, "2026-10-05", "2026-10-07", 7).risk).toBe("LATE")
    expect(workStand(5, 5, null, "2026-10-07", 0).risk).toBe("DONE")
    expect(workStand(2, 5, null, "2026-10-07", 0).risk).toBe("NO_DEADLINE")
  })
})

describe("habit lifecycle", () => {
  const today = "2026-10-07"
  const keys = (daysBack: number, skipEvery = 0) => {
    const s = new Set<string>()
    for (let i = 0; i < daysBack; i++) {
      if (skipEvery && i % skipEvery === 0 && i > 0) continue
      s.add(new Date(Date.parse(`${today}T00:00:00Z`) - i * DAY).toISOString().slice(0, 10))
    }
    return s
  }
  const base = (over: Partial<HabitLifeInput>): HabitLifeInput => ({
    createdAt: new Date(Date.parse(`${today}T00:00:00Z`) - 70 * DAY),
    frequency: "DAILY",
    weeklyTarget: null,
    specificDays: [],
    completedDayKeys: keys(70),
    todayKey: today,
    stage: "BUILDING",
    ...over,
  })
  it("a new habit stays new for two weeks", () => {
    expect(habitLife(base({ createdAt: new Date(Date.parse(`${today}T00:00:00Z`) - 5 * DAY), completedDayKeys: keys(5) })).stage).toBe("NEW")
  })
  it("graduates after about 80% for 8 weeks", () => {
    const h = habitLife(base({ completedDayKeys: keys(70, 6) })) // misses about one day in six (83%)
    expect(h.stage).toBe("AUTOMATIC")
    expect(h.consistency28).toBeGreaterThanOrEqual(22)
  })
  it("does not graduate a patchy habit, and a few misses do not demote an automatic one", () => {
    expect(habitLife(base({ completedDayKeys: keys(70, 2) })).stage).toBe("BUILDING")
    expect(habitLife(base({ stage: "AUTOMATIC", completedDayKeys: keys(70, 3) })).stage).toBe("AUTOMATIC")
  })
  it("only counts habits older than 8 weeks for graduation", () => {
    expect(habitLife(base({ createdAt: new Date(Date.parse(`${today}T00:00:00Z`) - 40 * DAY), completedDayKeys: keys(40) })).stage).toBe("BUILDING")
  })
})

describe("wording", () => {
  it("month phrases", () => {
    expect(monthPhrase(d("2027-03-15"))).toBe("mid-March")
    expect(monthPhrase(d("2027-04-02"))).toBe("early-April")
    expect(monthPhrase(d("2027-04-28"))).toBe("late-April")
  })
})
