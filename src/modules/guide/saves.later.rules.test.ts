import { describe, expect, it } from "vitest"
import { duration, findQueueItem, pickWatchLater, queueIntent, queueReply, suggestionLine, type QueueItem } from "./saves.later.rules.js"

const item = (id: string, title: string, minutes: number | null, daysAgo: number): QueueItem => ({
  id,
  title,
  minutes,
  url: null,
  platform: null,
  queuedAt: new Date(Date.UTC(2026, 9, 24) - daysAgo * 86_400_000),
})

describe("pickWatchLater", () => {
  const queue = [item("a", "Atomic Habits summary", 18, 3), item("b", "System design basics", 24, 10), item("c", "Long course", 120, 20), item("d", "Quick tip", null, 1)]
  it("offers the one waiting longest that fits", () => {
    expect(pickWatchLater(queue, 30, "EVENING", "NORMAL")?.id).toBe("b")
    expect(pickWatchLater(queue, 20, "EVENING", "NORMAL")?.id).toBe("a") // b is 24 min
    expect(pickWatchLater(queue, 150, "EVENING", "NORMAL")?.id).toBe("c")
  })
  it("is quiet at work, at night, in a mode, and when nothing fits", () => {
    expect(pickWatchLater(queue, 90, "OFFICE", "NORMAL")).toBeNull()
    expect(pickWatchLater(queue, 90, "NIGHT", "NORMAL")).toBeNull()
    expect(pickWatchLater(queue, 90, "EVENING", "SICK")).toBeNull()
    expect(pickWatchLater(queue, 90, "EVENING", "BUSY")).toBeNull()
    expect(pickWatchLater(queue, 10, "EVENING", "NORMAL")).toBeNull()
    expect(pickWatchLater([item("c", "Long course", 120, 1)], 60, "EVENING", "NORMAL")).toBeNull()
    expect(pickWatchLater([], 90, "EVENING", "NORMAL")).toBeNull()
  })
  it("outside the evening it needs an hour or more", () => {
    expect(pickWatchLater(queue, 45, "MORNING", "NORMAL")).toBeNull()
    expect(pickWatchLater(queue, 75, "MORNING", "NORMAL")?.id).toBe("b")
  })
  it("treats an item with no length as about 20 minutes", () => {
    expect(pickWatchLater([item("d", "Quick tip", null, 1)], 25, "EVENING", "NORMAL")?.id).toBe("d")
    expect(pickWatchLater([item("d", "Quick tip", null, 1)], 18, "EVENING", "NORMAL")).toBeNull()
  })
})

describe("queueIntent and findQueueItem", () => {
  it("reads show, watched and remove", () => {
    expect(queueIntent("show watch later")).toEqual({ kind: "SHOW" })
    expect(queueIntent("what's in my watch later")).toEqual({ kind: "SHOW" })
    expect(queueIntent("watch later")).toEqual({ kind: "SHOW" })
    expect(queueIntent("I watched Atomic Habits")).toEqual({ kind: "WATCHED", name: "Atomic Habits" })
    expect(queueIntent("remove the quick tip from watch later")).toEqual({ kind: "REMOVE", name: "the quick tip" })
    expect(queueIntent("hello")).toBeNull()
  })
  it("finds one item or none", () => {
    const q = [item("a", "Atomic Habits summary", 18, 1), item("b", "System design basics", 24, 1), item("c", "System design deep dive", 60, 1)]
    expect(findQueueItem("atomic habits", q)?.id).toBe("a")
    expect(findQueueItem("deep dive", q)?.id).toBe("c")
    expect(findQueueItem("system design", q)).toBeNull() // two
    expect(findQueueItem("nothing like it", q)).toBeNull()
  })
})

describe("words", () => {
  it("formats lengths and lines", () => {
    expect(duration(18)).toBe("18 min")
    expect(duration(125)).toBe("2 h 5 min")
    expect(duration(null)).toBe("length unknown")
    expect(suggestionLine({ title: "Atomic Habits summary", minutes: 18 })).toBe("You have time. Watch later: Atomic Habits summary (18 min)?")
    expect(queueReply([])).toContain("empty")
    expect(queueReply([item("a", "Atomic Habits summary", 18, 1)])).toBe("Watch later (1): Atomic Habits summary (18 min).")
  })
})
