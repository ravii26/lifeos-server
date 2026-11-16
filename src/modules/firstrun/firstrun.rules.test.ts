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
      { title: "Call the gym", kind: "TASK", areaName: "Health", due: null , dueKind: null, windowFrom: null, windowTo: null },
    ])
  })
})

describe("first run: where each item came from", () => {
  const text = "I want to switch job in 3 months, reduce my scrolling at night. Also call the bank tomorrow"
  const areas = [{ name: "Career", type: "PRIMARY" as const, icon: "briefcase" as const, color: "#1a56ff" as const }]
  const sort = (actions: Parameters<typeof fromExtraction>[0]["actions"]) => fromExtraction({ areas, actions }, today, text)

  it("their own words are 'said', with the part of the text it came from", () => {
    const [job] = sort([{ itemType: "GOAL", title: "Switch job", areaName: "Career", said: "switch job in 3 months" }])
    expect(job).toMatchObject({ origin: "SAID", said: "switch job in 3 months", ideaFor: null })
  })
  it("a quote that is not in the text is replaced by the real part", () => {
    const [job] = sort([{ itemType: "GOAL", title: "Switch job", areaName: "Career", said: "I dream of a new career" }])
    expect(job).toMatchObject({ origin: "SAID", said: "I want to switch job in 3 months" })
  })
  it("a task the AI made out of a wish is Ally's idea, whatever the AI calls it", () => {
    const [idea] = sort([
      { itemType: "TASK", title: "Draft a personal weekly schedule to reduce scrolling", areaName: "Career", detail: "A plan for the evening leaves less room to scroll.", suggested: false },
    ])
    expect(idea).toMatchObject({ origin: "IDEA", said: null, ideaFor: "reduce my scrolling at night", reason: "A plan for the evening leaves less room to scroll." })
  })
  it("an idea the AI marks itself keeps what it is for, when those words are theirs", () => {
    const [idea] = sort([{ itemType: "TASK", title: "Update the resume", areaName: "Career", suggested: true, for: "switch job", detail: "Needed before applying." }])
    expect(idea).toMatchObject({ origin: "IDEA", ideaFor: "switch job", reason: "Needed before applying." })
  })
  it("an idea with nothing of theirs behind it is dropped, and at most three ideas are kept", () => {
    expect(sort([{ itemType: "TASK", title: "Meditate daily", areaName: "Career", suggested: true }])).toEqual([])
    const many = sort([1, 2, 3, 4, 5].map((n) => ({ itemType: "TASK" as const, title: `Idea ${n}`, areaName: "Career", suggested: true, for: "switch job" })))
    expect(many).toHaveLength(3)
  })
  it("when is read from their words even when the title leaves the day out", () => {
    const [call] = sort([{ itemType: "TASK", title: "Call the bank", areaName: "Career", said: "call the bank tomorrow" }])
    expect(call).toMatchObject({ origin: "SAID", due: "2026-11-16", dueKind: "ON" })
  })
  it("without AI everything is their own words", () => {
    const items = fallbackSort("pay the electricity bill\nlearn guitar maybe", today)
    expect(items.map((i) => [i.origin, i.said])).toEqual([
      ["SAID", "pay the electricity bill"],
      ["SAID", "learn guitar maybe"],
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
