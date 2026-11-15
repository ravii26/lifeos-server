import { describe, expect, it } from "vitest"
import { answersText, cautionFor, cleanPlan, fallbackPlan, fitPlan, FIRST_STEP_MAX } from "./goalplan.rules.js"

const today = "2026-10-15"

describe("cleanPlan", () => {
  it("keeps sensible targets and drops broken ones", () => {
    const p = cleanPlan(
      {
        title: "Job switch",
        deadline: "2026-12-15",
        targets: [
          { title: "DSA", unit: "min", perWeek: 360, sessionMinutes: 50, block: "MORNING", note: "≈ 50 min most mornings" },
          { title: "Job applications", unit: "count", perWeek: 10, countUnit: "applications" },
          { title: "Nonsense", unit: "hours", perWeek: 3 },
          { title: "", unit: "min", perWeek: 60 },
          { title: "Office stuff", unit: "min", perWeek: 60, block: "OFFICE" },
        ],
        milestones: ["Resume ready", "", "First interviews"],
      },
      today,
    )!
    expect(p.targets.map((t) => t.title)).toEqual(["DSA", "Job applications", "Office stuff"])
    expect(p.targets[1]).toMatchObject({ unit: "count", countUnit: "applications" })
    expect(p.targets[2]!.block).toBeNull() // personal goals stay out of office hours
    expect(p.milestones).toEqual(["Resume ready", "First interviews"])
    expect(p.deadline).toBe("2026-12-15")
  })

  it("never keeps a deadline in the past, and nothing without a title", () => {
    expect(cleanPlan({ title: "X", deadline: "2026-01-01", targets: [{ title: "A", unit: "min", perWeek: 60 }] }, today)?.deadline).toBeNull()
    expect(cleanPlan({ targets: [{ title: "A", unit: "min", perWeek: 60 }] }, today)).toBeNull()
  })

  it("a plan that only asks a question is still a plan to show", () => {
    expect(cleanPlan({ title: "Learn guitar", targets: [], question: "When do you want to play your first song?" }, today)?.question).toMatch(/When/)
  })
})

describe("fitPlan (a better way, by code)", () => {
  const plan = cleanPlan(
    {
      title: "Job switch",
      targets: [
        { title: "DSA", unit: "min", perWeek: 600 },
        { title: "Applications", unit: "count", perWeek: 20, sessionMinutes: 15, countUnit: "applications" },
      ],
    },
    today,
  )!

  it("leaves a plan alone when it fits", () => {
    const { fit } = fitPlan(plan, 2000, 0) // 900 min planned, 1600 room
    expect(fit.scaled).toBe(false)
  })

  it("scales every part down when it doesn't fit, and says so", () => {
    const { plan: p, fit } = fitPlan(plan, 1000, 200) // room = 800 - 200 = 600 for 900 planned
    expect(fit.scaled).toBe(true)
    expect(p.targets[0]!.perWeek).toBe(400)
    expect(p.targets[1]!.perWeek).toBe(13)
    expect(fit.message).toMatch(/scaled each part down/)
  })
})

describe("cautionFor (not now)", () => {
  it("a Main goal due within 6 weeks and behind gets a 'park it?'", () => {
    const c = cautionFor([{ title: "Interview prep", tier: "MAIN", deadlineKey: "2026-11-19", behind: true }], today)
    expect(c?.message).toMatch(/Interview prep is in 5 weeks and already behind/)
    expect(c?.parkUntil).toBe("2026-11-19")
  })

  it("no caution when on pace, far away, or not Main", () => {
    expect(cautionFor([{ title: "A", tier: "MAIN", deadlineKey: "2026-11-19", behind: false }], today)).toBeNull()
    expect(cautionFor([{ title: "A", tier: "MAIN", deadlineKey: "2027-03-01", behind: true }], today)).toBeNull()
    expect(cautionFor([{ title: "A", tier: "SECONDARY", deadlineKey: "2026-11-19", behind: true }], today)).toBeNull()
  })
})

describe("first steps (make a goal concrete)", () => {
  const base = { title: "Start writing online", targets: [{ title: "Writing", unit: "min", perWeek: 120 }] }

  it("step one is cut to 15 minutes by code, whatever was proposed", () => {
    const p = cleanPlan({ ...base, steps: [{ title: "Draft the first post", minutes: 60 }, { title: "Publish it", minutes: 30 }] }, today)!
    expect(p.steps[0]).toEqual({ title: "Draft the first post", minutes: FIRST_STEP_MAX })
    expect(p.steps[1]!.minutes).toBe(30)
  })

  it("broken lengths become 15, empty steps are dropped, at most 5", () => {
    const p = cleanPlan({ ...base, steps: [{ title: "" }, { title: "A", minutes: 500 }, ...Array.from({ length: 8 }, (_, i) => ({ title: `S${i}`, minutes: 20 }))] }, today)!
    expect(p.steps[0]).toEqual({ title: "A", minutes: 15 })
    expect(p.steps).toHaveLength(5)
  })

  it("with no steps proposed there is still a step one", () => {
    const p = cleanPlan(base, today)!
    expect(p.steps).toHaveLength(1)
    expect(p.steps[0]!.minutes).toBe(15)
    expect(p.steps[0]!.title).toContain("Start writing online")
  })
})

describe("the answers", () => {
  it("become one message, leaving out what was not said", () => {
    expect(answersText({ text: "Learn to swim", why: "Holidays", weeklyMinutes: 90 })).toBe(
      "Learn to swim\nWhy it matters: Holidays\nTime I can give each week: about 90 minutes",
    )
  })

  it("without AI, code drafts a plan from them", () => {
    const p = fallbackPlan({ text: "Learn to swim.", why: "Holidays", done: "Swim one length", weeklyMinutes: 90 })
    expect(p.title).toBe("Learn to swim.")
    expect(p.targets).toEqual([expect.objectContaining({ unit: "min", perWeek: 90, sessionMinutes: 30 })])
    expect(p.milestones).toEqual(["Swim one length"])
    expect(p.steps).toEqual([{ title: "Write down the first three things to do for Learn to swim", minutes: 15 }])
  })

  it("a code plan stays within sensible bounds", () => {
    expect(fallbackPlan({ text: "Something", weeklyMinutes: 5 }).targets[0]!.perWeek).toBe(30)
    expect(fallbackPlan({ text: "Something" }).targets[0]!.perWeek).toBe(120)
  })
})

describe("the time they said", () => {
  const plan = cleanPlan({ title: "Music", targets: [{ title: "Practice", unit: "min", perWeek: 300 }] }, today)!

  it("is never planned past, even with lots of free time", () => {
    const { plan: p, fit } = fitPlan(plan, 3000, 0, 120)
    expect(p.targets[0]!.perWeek).toBe(132) // a little over 2 h is fine
    expect(fit.message).toContain("You said about 2 h")
  })

  it("free time still wins when it is the smaller", () => {
    const { fit } = fitPlan(plan, 200, 0, 600)
    expect(fit.message).toContain("free after your other goals")
  })
})
