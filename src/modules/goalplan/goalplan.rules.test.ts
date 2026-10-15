import { describe, expect, it } from "vitest"
import { cautionFor, cleanPlan, fitPlan } from "./goalplan.rules.js"

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
