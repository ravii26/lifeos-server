import { describe, it, expect } from "vitest"
import { buildFitnessPlan, daysForWeek, WEEK1_CAP, type FitnessAnswers } from "./fitness.rules.js"

const base: FitnessAnswers = { goal: "LOSE_BELLY", weightKg: 83, heightCm: 173, where: "GYM", diet: null, homeFood: true, messFood: false, outsideOften: true, health: "JOINT" }

describe("buildFitnessPlan", () => {
  it("makes the agreed plan for 83 kg, belly first, knee pain, junk often", () => {
    const p = buildFitnessPlan(base)
    expect(p.title).toBe("83 → 79 kg, belly first")
    expect(p.weight).toEqual({ start: 83, target: 79 })
    expect(p.sessions[0]).toMatchObject({ key: "STRENGTH", title: "Gym: knee-friendly strength + cycling", minutes: 40, days: ["MON", "WED", "FRI"] })
    expect(p.sessions[0]!.detail).toMatch(/cycling/)
    expect(p.sessions[0]!.detail).not.toMatch(/squats,|lunges/)
    expect(p.sessions[1]).toMatchObject({ key: "WALK", title: "Brisk walk on flat ground", days: ["TUE", "THU", "SAT"] })
    expect(p.foodRules[2]).toMatch(/twice a week, planned/)
    expect(p.lifeRules.join(" ")).toMatch(/Knee hurts/)
    expect(p.cautions.join(" ")).toMatch(/no running/i)
  })

  it("caps week 1 at 4 sessions, then fills out", () => {
    const p = buildFitnessPlan(base)
    const week1 = p.sessions.reduce((n, s) => n + daysForWeek(s, 1).length, 0)
    const week2 = p.sessions.reduce((n, s) => n + daysForWeek(s, 2).length, 0)
    expect(week1).toBe(WEEK1_CAP)
    expect(week2).toBe(6)
  })

  it("never sets a weight target without a weight, or for muscle and stamina", () => {
    expect(buildFitnessPlan({ ...base, weightKg: null }).weight).toBeNull()
    expect(buildFitnessPlan({ ...base, weightKg: null }).title).toBe("Lose belly fat")
    expect(buildFitnessPlan({ ...base, goal: "BUILD_MUSCLE" }).weight).toBeNull()
    expect(buildFitnessPlan({ ...base, weightKg: 12 }).weight).toBeNull() // not a real adult weight
  })

  it("adapts to home, diet, mess food and health conditions", () => {
    const p = buildFitnessPlan({ ...base, where: "HOME", health: "CONDITION", diet: "VEG", messFood: true, outsideOften: false })
    expect(p.sessions[0]!.title).toBe("Home workout")
    expect(p.foodRules[0]).toMatch(/paneer/)
    expect(p.foodRules[0]).not.toMatch(/egg/)
    expect(p.foodRules.join(" ")).toMatch(/Mess or PG/)
    expect(p.foodRules[2]).toBe("Outside food at most twice a week")
    expect(p.cautions.join(" ")).toMatch(/check with your doctor/)
    expect(p.lifeRules.join(" ")).not.toMatch(/Knee/)
  })
})
