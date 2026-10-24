/* =====================================================================
   "Saved 12, acted on 4" and "Still want these?" (Phase D slice D7,
   ADR 0044), worked out by code from the saves and what became of each.
   Saves left undecided for 30 days are asked about, never nagged.
   ===================================================================== */

export type Outcome = "acted" | "later" | "watched" | "list" | "shelf" | "letGo" | "waiting"

export interface SaveRow {
  id: string
  title: string
  createdAt: Date
  status: "PENDING" | "CONVERTED" | "DISMISSED"
  outcomeType: string | null // createdOutputs.type
}

export const outcomeOf = (r: Pick<SaveRow, "status" | "outcomeType">): Outcome => {
  if (r.status === "PENDING") return "waiting"
  if (r.status === "DISMISSED") return "letGo"
  switch (r.outcomeType) {
    case "TASK":
    case "HABIT":
      return "acted"
    case "LATER":
      return "later"
    case "WATCHED":
      return "watched"
    case "LIST":
      return "list"
    case "VAULT":
      return "shelf"
    default:
      return "acted"
  }
}

export interface SaveCounts {
  saved: number
  acted: number
  later: number
  watched: number
  list: number
  shelf: number
  letGo: number
  waiting: number
}

export const countSaves = (rows: SaveRow[], now: Date, days: number): SaveCounts => {
  const since = now.getTime() - days * 86_400_000
  const out: SaveCounts = { saved: 0, acted: 0, later: 0, watched: 0, list: 0, shelf: 0, letGo: 0, waiting: 0 }
  for (const r of rows) {
    if (r.createdAt.getTime() < since) continue
    out.saved++
    out[outcomeOf(r)]++
  }
  return out
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export const summaryReply = (c: SaveCounts, days: number): string => {
  const when = days === 7 ? "this week" : `in the last ${days} days`
  if (c.saved === 0) return `You haven't saved anything ${when}.`
  const bits = [
    c.acted ? `${plural(c.acted, "became an action", "became actions")}` : null,
    c.later ? `${c.later} ${c.later === 1 ? "waits" : "wait"} in watch later` : null,
    c.watched ? `${c.watched} watched` : null,
    c.list ? `${c.list} went on a list` : null,
    c.shelf ? `${c.shelf} ${c.shelf === 1 ? "is" : "are"} on your shelf` : null,
    c.letGo ? `${c.letGo} you let go` : null,
    c.waiting ? `${c.waiting} still ${c.waiting === 1 ? "needs" : "need"} a decision` : null,
  ].filter(Boolean)
  return `You saved ${c.saved} ${when}: ${bits.join(", ")}.`
}

// One short line for the Sunday review.
export const weekLine = (c: SaveCounts): string | null =>
  c.saved === 0 ? null : `Saves: ${c.saved} saved, ${c.acted + c.watched + c.list} used${c.later ? `, ${c.later} in watch later` : ""}${c.waiting ? `, ${c.waiting} undecided` : ""}`

// Waiting, undecided for this long.
export const STALE_DAYS = 30

export const staleSaves = (rows: SaveRow[], now: Date): SaveRow[] =>
  rows.filter((r) => r.status === "PENDING" && now.getTime() - r.createdAt.getTime() >= STALE_DAYS * 86_400_000).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

export const staleReply = (stale: SaveRow[]): string => {
  if (!stale.length) return "Nothing has been waiting more than a month. All your saves are either decided or recent."
  const shown = stale.slice(0, 5).map((s) => s.title)
  const them = stale.length === 1 ? "it" : "them"
  return `${plural(stale.length, "save has", "saves have")} waited over a month without a decision: ${shown.join("; ")}${stale.length > 5 ? `; and ${stale.length - 5} more` : ""}. Still want ${stale.length === 1 ? "it" : "these"}? Say "let go of old saves" to clear ${them}, or leave ${them} as ${stale.length === 1 ? "it is" : "they are"}.`
}

export type SummaryIntent = { kind: "SUMMARY"; days: number } | { kind: "STALE" } | { kind: "LET_GO_STALE" } | { kind: "REST_TO_LATER" }

const SUMMARY = /^(?:how many (?:of my )?saves(?: did i (?:act on|use|save))?(?: (?:this week|today|this month))?|what did i do with my saves|(?:my )?saves (?:this week|summary|this month)|how are my saves)$/i
const STALE = /^(?:still want these|(?:show )?(?:my )?old saves|what saves are (?:old|waiting)|which saves are (?:old|waiting))$/i
const LET_GO = /^let go of (?:all )?(?:the )?old saves$/i
const REST_LATER = /^put (?:the )?(?:other|rest|remaining|others)(?: \d+| of them)? (?:in|into|on) watch ?later$/i

export const summaryIntent = (text: string): SummaryIntent | null => {
  const t = text.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ")
  if (!t || t.split(/\s+/).length > 12) return null
  if (REST_LATER.test(t)) return { kind: "REST_TO_LATER" }
  if (LET_GO.test(t)) return { kind: "LET_GO_STALE" }
  if (STALE.test(t)) return { kind: "STALE" }
  if (SUMMARY.test(t)) return { kind: "SUMMARY", days: /this month/i.test(t) ? 30 : 7 }
  return null
}
