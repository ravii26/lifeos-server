import { describe, expect, it } from "vitest"
import { countSaves, outcomeOf, staleReply, staleSaves, summaryIntent, summaryReply, weekLine, type SaveRow } from "./saves.summary.rules.js"

const now = new Date(Date.UTC(2026, 9, 24, 12))
const row = (id: string, daysAgo: number, status: SaveRow["status"], outcomeType: string | null = null, title = `Save ${id}`): SaveRow => ({
  id,
  title,
  createdAt: new Date(now.getTime() - daysAgo * 86_400_000),
  status,
  outcomeType,
})

describe("outcomeOf and countSaves", () => {
  it("maps what became of a save", () => {
    expect(outcomeOf({ status: "PENDING", outcomeType: null })).toBe("waiting")
    expect(outcomeOf({ status: "DISMISSED", outcomeType: null })).toBe("letGo")
    expect(outcomeOf({ status: "CONVERTED", outcomeType: "TASK" })).toBe("acted")
    expect(outcomeOf({ status: "CONVERTED", outcomeType: "HABIT" })).toBe("acted")
    expect(outcomeOf({ status: "CONVERTED", outcomeType: "LATER" })).toBe("later")
    expect(outcomeOf({ status: "CONVERTED", outcomeType: "VAULT" })).toBe("shelf")
    expect(outcomeOf({ status: "CONVERTED", outcomeType: "LIST" })).toBe("list")
    expect(outcomeOf({ status: "CONVERTED", outcomeType: "WATCHED" })).toBe("watched")
  })
  it("counts only the last days", () => {
    const rows = [row("1", 1, "CONVERTED", "TASK"), row("2", 2, "CONVERTED", "LATER"), row("3", 3, "PENDING"), row("4", 20, "CONVERTED", "TASK"), row("5", 6, "DISMISSED")]
    expect(countSaves(rows, now, 7)).toEqual({ saved: 4, acted: 1, later: 1, watched: 0, list: 0, shelf: 0, letGo: 1, waiting: 1 })
    expect(countSaves(rows, now, 30).saved).toBe(5)
  })
})

describe("words", () => {
  it("says what happened to the saves without judging", () => {
    const c = countSaves([row("1", 1, "CONVERTED", "TASK"), row("2", 1, "CONVERTED", "LATER"), row("3", 2, "CONVERTED", "LATER"), row("4", 2, "PENDING")], now, 7)
    expect(summaryReply(c, 7)).toBe("You saved 4 this week: 1 became an action, 2 wait in watch later, 1 still needs a decision.")
    expect(summaryReply(countSaves([], now, 7), 7)).toBe("You haven't saved anything this week.")
    expect(weekLine(c)).toBe("Saves: 4 saved, 1 used, 2 in watch later, 1 undecided")
    expect(weekLine(countSaves([], now, 7))).toBeNull()
    expect(summaryReply(c, 7)).not.toMatch(/wast|lazy|should|only|fail/i)
  })
  it("asks about saves waiting over a month", () => {
    const rows = [row("1", 40, "PENDING", null, "Old video"), row("2", 31, "PENDING", null, "Older article"), row("3", 5, "PENDING"), row("4", 50, "CONVERTED", "LATER")]
    const stale = staleSaves(rows, now)
    expect(stale.map((s) => s.id)).toEqual(["1", "2"])
    expect(staleReply(stale)).toContain("2 saves have waited over a month")
    expect(staleReply(stale)).toContain("Old video; Older article")
    expect(staleReply([])).toContain("Nothing has been waiting")
  })
})

describe("summaryIntent", () => {
  it("reads the phrases", () => {
    expect(summaryIntent("how many saves did I act on this week")).toEqual({ kind: "SUMMARY", days: 7 })
    expect(summaryIntent("what did I do with my saves")).toEqual({ kind: "SUMMARY", days: 7 })
    expect(summaryIntent("saves this month")).toEqual({ kind: "SUMMARY", days: 30 })
    expect(summaryIntent("still want these?")).toEqual({ kind: "STALE" })
    expect(summaryIntent("show my old saves")).toEqual({ kind: "STALE" })
    expect(summaryIntent("let go of old saves")).toEqual({ kind: "LET_GO_STALE" })
    expect(summaryIntent("put the other 7 in watch later")).toEqual({ kind: "REST_TO_LATER" })
    expect(summaryIntent("put the rest in watch later")).toEqual({ kind: "REST_TO_LATER" })
    expect(summaryIntent("hello")).toBeNull()
  })
})
