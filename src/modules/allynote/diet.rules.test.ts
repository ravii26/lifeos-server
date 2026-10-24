import { describe, expect, it } from "vitest"
import {
  askReply,
  dayKeys,
  dietIntent,
  isDietMeta,
  itemsFromMealNames,
  mealFor,
  mealsOf,
  mergeDiet,
  nextMealAt,
  parseMeals,
  savedReply,
  weekMealTexts,
  weekReply,
  type DietMeta,
} from "./diet.rules.js"

describe("parseMeals", () => {
  it("reads 'X for meal' and 'meal: X' forms", () => {
    expect(parseMeals("oats and eggs for breakfast, dal rice for lunch, roti sabzi for dinner")).toEqual({ breakfast: "oats and eggs", lunch: "dal rice", dinner: "roti sabzi" })
    expect(parseMeals("breakfast: poha; lunch: rajma chawal; snacks: fruit")).toEqual({ breakfast: "poha", lunch: "rajma chawal", snack: "fruit" })
    expect(parseMeals("oats, boiled eggs for breakfast; paneer for dinner")).toEqual({ breakfast: "oats, boiled eggs", dinner: "paneer" })
    expect(parseMeals("just some words")).toEqual({})
  })

  it("reads the meal-first form with no separator", () => {
    expect(parseMeals("breakfast oats, lunch dal rice, dinner paneer roti")).toEqual({ breakfast: "oats", lunch: "dal rice", dinner: "paneer roti" })
    expect(parseMeals("breakfast poha, and dinner khichdi")).toEqual({ breakfast: "poha", dinner: "khichdi" })
    // One part without a meal: not a diet, the AI decides.
    expect(parseMeals("breakfast oats, gym at 7")).toEqual({})
    expect(dietIntent("Monday diet: breakfast oats, lunch dal rice, dinner paneer roti")).toEqual({ kind: "SET", days: ["1"], meals: { breakfast: "oats", lunch: "dal rice", dinner: "paneer roti" } })
  })
})

describe("dietIntent: setting the plan", () => {
  it("reads a day's whole diet", () => {
    expect(dietIntent("Monday diet: oats and eggs for breakfast, dal rice for lunch, roti sabzi for dinner")).toEqual({
      kind: "SET",
      days: ["1"],
      meals: { breakfast: "oats and eggs", lunch: "dal rice", dinner: "roti sabzi" },
    })
    expect(dietIntent("diet for Wednesday: oats for breakfast")).toEqual({ kind: "SET", days: ["3"], meals: { breakfast: "oats" } })
    expect(dietIntent("Tuesday's meals: breakfast: poha; lunch: rajma chawal")).toEqual({ kind: "SET", days: ["2"], meals: { breakfast: "poha", lunch: "rajma chawal" } })
  })
  it("reads one meal, every day, weekdays and weekends", () => {
    expect(dietIntent("every day breakfast: oats and eggs")).toEqual({ kind: "SET", days: ["all"], meals: { breakfast: "oats and eggs" } })
    expect(dietIntent("weekdays lunch is dal rice")).toEqual({ kind: "SET", days: ["1", "2", "3", "4", "5"], meals: { lunch: "dal rice" } })
    expect(dietIntent("set dinner on Fridays to paneer wrap")).toEqual({ kind: "SET", days: ["5"], meals: { dinner: "paneer wrap" } })
    expect(dayKeys("weekends")).toEqual(["0", "6"])
    expect(dayKeys("nonsense")).toBeNull()
  })
})

describe("dietIntent: asking", () => {
  it("reads questions about a meal or a day", () => {
    expect(dietIntent("what's for lunch?")).toEqual({ kind: "ASK", day: "TODAY", meal: "lunch" })
    expect(dietIntent("what's for dinner tomorrow")).toEqual({ kind: "ASK", day: "TOMORROW", meal: "dinner" })
    expect(dietIntent("what's for breakfast on Friday")).toEqual({ kind: "ASK", day: 5, meal: "breakfast" })
    expect(dietIntent("what should I eat today")).toEqual({ kind: "ASK", day: "TODAY", meal: null })
    expect(dietIntent("what should I have for lunch")).toEqual({ kind: "ASK", day: "TODAY", meal: "lunch" })
    expect(dietIntent("what's my diet for Monday")).toEqual({ kind: "ASK", day: 1, meal: null })
    expect(dietIntent("show my diet")).toEqual({ kind: "SHOW" })
  })
  it("reads the shopping-from-diet request", () => {
    expect(dietIntent("shopping list from my diet")).toEqual({ kind: "SHOPPING" })
    expect(dietIntent("make a shopping list from my diet")).toEqual({ kind: "SHOPPING" })
    expect(dietIntent("groceries for this week's diet")).toEqual({ kind: "SHOPPING" })
    expect(dietIntent("shopping list for the week's diet")).toEqual({ kind: "SHOPPING" })
  })
  it("leaves other sentences alone", () => {
    expect(dietIntent("what's today")).toBeNull()
    expect(dietIntent("what")).toBeNull()
    expect(dietIntent("what can I eat for breakfast")).toBeNull()
    expect(dietIntent("add milk to shopping")).toBeNull()
    expect(dietIntent("I want to lose weight with a better diet")).toBeNull()
  })
})

describe("reading the plan", () => {
  const meta: DietMeta = { days: { all: { breakfast: "oats" }, "1": { lunch: "dal rice", breakfast: "poha" } } }
  it("a day's meal beats the every-day one", () => {
    expect(mealFor(meta, 1, "breakfast")).toBe("poha")
    expect(mealFor(meta, 2, "breakfast")).toBe("oats")
    expect(mealFor(meta, 2, "lunch")).toBeNull()
    expect(mealsOf(meta, 1)).toEqual({ breakfast: "poha", lunch: "dal rice" })
  })
  it("merges without losing other meals or days", () => {
    const next = mergeDiet(meta, ["1"], { dinner: "paneer" })
    expect(next.days["1"]).toEqual({ lunch: "dal rice", breakfast: "poha", dinner: "paneer" })
    expect(next.days.all).toEqual({ breakfast: "oats" })
    expect(meta.days["1"]!.dinner).toBeUndefined() // the old plan is not changed
    expect(isDietMeta(next)).toBe(true)
    expect(isDietMeta({ x: 1 })).toBe(false)
  })
  it("picks the next meal by the hour", () => {
    expect([8, 12, 16, 20, 23].map(nextMealAt)).toEqual(["breakfast", "lunch", "snack", "dinner", "breakfast"])
  })
  it("answers plainly", () => {
    expect(askReply(meta, 1, "today", "lunch")).toBe("Lunch today: dal rice.")
    expect(askReply(meta, 1, "today", null)).toBe("Today: breakfast poha; lunch dal rice.")
    expect(askReply(meta, 2, "tomorrow", "dinner")).toContain("Nothing planned for dinner tomorrow")
    expect(weekReply(meta)).toBe("Every day: breakfast oats\nMonday: breakfast poha; lunch dal rice")
    expect(weekReply(null)).toContain("haven't set a diet")
    expect(savedReply(["1"], { breakfast: "oats" })).toBe("Saved Monday's diet: breakfast oats.")
    expect(savedReply(["all"], { breakfast: "oats" })).toBe("Saved. Every day: breakfast oats.")
  })
  it("lists the week's meals once, and splits names into items without the AI", () => {
    expect(weekMealTexts(meta).sort()).toEqual(["dal rice", "oats", "poha"])
    expect(itemsFromMealNames(["oats and eggs", "dal rice with curd", "oats"])).toEqual(["Oats", "Eggs", "Dal rice", "Curd"])
  })
})
