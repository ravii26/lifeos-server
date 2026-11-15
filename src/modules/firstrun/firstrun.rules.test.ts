import { describe, expect, it } from "vitest"
import { fallbackSort, fromExtraction, guessArea, kindOf, suggestModes, type SortItem } from "./firstrun.rules.js"
import { isGuestEmail, GUEST_DOMAIN } from "../auth/auth.service.js"

const today = "2026-11-15"

describe("first run: sorting", () => {
  it("without AI, one thing per line with a guessed area and kind", () => {
    const items = fallbackSort("switch job in 3 months\nlose weight\npay the electricity bill\nread every night\nlearn guitar maybe")
    expect(items.map((i) => [i.areaName, i.kind])).toEqual([
      ["Career", "GOAL"],
      ["Health", "GOAL"],
      ["Money", "TASK"],
      ["Learning", "HABIT"],
      ["Learning", "GOAL"],
    ])
  })
  it("anything unknown goes to Other, to be moved", () => {
    expect(guessArea("Fix the bike")).toBe("Other")
    expect(kindOf("Buy a gift")).toBe("TASK")
  })
  it("keeps only valid AI items: a title, a future date, a known area", () => {
    const items = fromExtraction(
      {
        areas: [{ name: "Work", type: "PRIMARY", icon: "briefcase", color: "#1a56ff" }],
        actions: [
          { itemType: "GOAL", title: "Get a new job", areaName: "Work", dueDate: "2027-02-01" },
          { itemType: "TASK", title: "Call the gym", areaName: "Nowhere", dueDate: "2020-01-01" },
          { itemType: "HABIT", title: "  ", areaName: "Work" },
        ],
      },
      today,
    )
    expect(items).toEqual([
      { title: "Get a new job", kind: "GOAL", areaName: "Work", due: "2027-02-01" },
      { title: "Call the gym", kind: "TASK", areaName: "Health", due: null },
    ])
  })
})

describe("first run: modes", () => {
  const items: SortItem[] = [
    { title: "Switch job", kind: "GOAL", areaName: "Career", due: "2027-02-01" },
    { title: "Lose weight", kind: "GOAL", areaName: "Health", due: null },
    { title: "Save for a trip", kind: "GOAL", areaName: "Money", due: null },
    { title: "Pay the card bill", kind: "TASK", areaName: "Money", due: null },
    { title: "Learn guitar", kind: "GOAL", areaName: "Music", due: null },
  ]
  const text = "switch job in 2-3 months. lose weight. save for a trip. pay the card bill. maybe learn guitar"

  it("deadlines and clear goals push, at most two; maybe explores; the rest is steady", () => {
    const m = suggestModes(items, text, today)
    expect(m.map((a) => [a.name, a.mode])).toEqual([
      ["Career", "PUSH"],
      ["Health", "PUSH"],
      ["Money", "MAINTAIN"],
      ["Music", "EXPLORE"],
    ])
    expect(m[0]!.reason).toContain("deadline")
    expect(m[2]!.reason).toContain("two at a time")
  })
  it("chores alone are kept steady", () => {
    expect(suggestModes([{ title: "Clean the kitchen", kind: "TASK", areaName: "Home", due: null }], "clean the kitchen", today)[0]!.mode).toBe("MAINTAIN")
  })
})

describe("guest accounts", () => {
  it("are on a domain nobody can receive mail at", () => {
    expect(GUEST_DOMAIN.endsWith(".invalid")).toBe(true)
    expect(isGuestEmail(`guest-1@${GUEST_DOMAIN}`)).toBe(true)
    expect(isGuestEmail("sam@example.com")).toBe(false)
  })
})
