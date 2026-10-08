import { describe, expect, it } from "vitest"
import { pickNotesForPrompt, searchItems, searchMessage, stem, tokenize, visibleMemories, type Searchable } from "./search.rules.js"

describe("stemming", () => {
  it("treats cache / caching / cached / caches as one word", () => {
    expect(new Set(["cache", "caching", "cached", "caches"].map(stem)).size).toBe(1)
  })
})

describe("search", () => {
  const items: Searchable[] = [
    { kind: "NOTE", id: "n1", title: "System design", body: "Caching: use Redis for hot reads.\nQueues: Kafka for events." },
    { kind: "TASK", id: "t1", title: "Read the caching chapter", body: "" },
    { kind: "SAVE", id: "s1", title: "Redis caching explained (video)", body: "A 10 minute summary of cache invalidation" },
    { kind: "TASK", id: "t2", title: "Buy milk", body: "" },
    { kind: "PROJECT", id: "p1", title: "Switch jobs", body: "Better growth" },
  ]
  it("finds what was saved about a topic across kinds, best first", () => {
    const hits = searchItems(items, "What did I save about caching?")
    expect(hits.map((h) => h.id).sort()).toEqual(["n1", "s1", "t1"])
    expect(hits.map((h) => h.kind).sort()).toEqual(["NOTE", "SAVE", "TASK"])
    expect(hits[0]!.kind).not.toBe("NOTE") // a title match outranks a body match
  })
  it("returns nothing, and says so, when nothing matches", () => {
    const hits = searchItems(items, "tax returns")
    expect(hits).toHaveLength(0)
    expect(searchMessage("tax returns", hits)).toMatch(/couldn't find anything/)
  })
  it("quotes the matching line for a body hit", () => {
    const hit = searchItems(items, "kafka").find((h) => h.id === "n1")!
    expect(hit.snippet).toMatch(/Kafka/)
  })
  it("tokenizing drops question filler", () => {
    expect(tokenize("What did I save about caching?")).toEqual(["cach"])
  })
})

describe("memory privacy", () => {
  const mem = [
    { content: "Works 10am to 8:30pm on weekdays", sensitive: false },
    { content: "Gets panic attacks before presentations", sensitive: true },
  ]
  it("keeps sensitive memories out unless the person raises the topic", () => {
    expect(visibleMemories(mem, "what should I eat for breakfast?")).toHaveLength(1)
    expect(visibleMemories(mem, "I have a presentation tomorrow and I'm nervous")).toHaveLength(2)
    expect(visibleMemories(mem, "any tips for my panic?")).toHaveLength(2)
  })
})

describe("notes in the prompt", () => {
  const note = (id: string, collection: string, items: string[], day: number) => ({
    id, collection, title: collection, items, text: null, updatedAt: new Date(2026, 9, day),
  })
  it("puts notes that match the question first", () => {
    const notes = [note("a", "Gym", ["jog", "squats"], 7), note("b", "Breakfast", ["poha", "oats"], 1), note("c", "Office", ["standup"], 5)]
    expect(pickNotesForPrompt(notes, "what can I eat for breakfast", 2)[0]!.id).toBe("b")
  })
})
