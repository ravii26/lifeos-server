/* =====================================================================
   Watch later (Phase D slice D6, ADR 0043), decided by code. A save the
   person queued instead of acting on. Now offers one when there is room
   for it, never at work or at night, never in a mode that asks for the
   smallest thing, and chat can show the queue ("show watch later") or
   tick one off ("I watched Atomic Habits").
   ===================================================================== */

export interface QueueItem {
  id: string
  title: string
  minutes: number | null
  url: string | null
  platform: string | null
  queuedAt: Date
}

// An item with no length is treated as this long when asking whether it fits.
export const ASSUMED_MINUTES = 20
const MIN_FREE = 15
const LONG_FREE = 60

// Which part of the day suits it: evenings, or any open stretch of an hour or more
// that is not work or night.
const suits = (block: string, free: number): boolean => {
  if (block === "OFFICE" || block === "NIGHT") return false
  return block === "EVENING" ? free >= MIN_FREE : free >= LONG_FREE
}

export const pickWatchLater = (items: QueueItem[], freeMinutes: number, block: string, mode: string): QueueItem | null => {
  if (mode !== "NORMAL" || !suits(block, freeMinutes)) return null
  const fits = items.filter((i) => (i.minutes ?? ASSUMED_MINUTES) <= freeMinutes)
  if (!fits.length) return null
  // The one waiting longest, so the queue clears instead of only growing; the shorter wins a tie.
  return [...fits].sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime() || (a.minutes ?? ASSUMED_MINUTES) - (b.minutes ?? ASSUMED_MINUTES))[0]!
}

export type QueueIntent = { kind: "SHOW" } | { kind: "WATCHED"; name: string } | { kind: "REMOVE"; name: string }

const SHOW = /^(?:show|open|see|what(?:'s| is) (?:in|on)|list)\s+(?:me\s+)?(?:my\s+)?watch ?(?:later|list|queue)(?: list)?$|^watch ?later$/i
const WATCHED = /^(?:i\s+)?(?:watched|finished watching|done watching|saw)\s+(.{2,80})$/i
const REMOVE = /^(?:remove|delete|take)\s+(.{2,80}?)\s+(?:from|off)\s+(?:my\s+)?watch ?(?:later|list|queue)$/i

export const queueIntent = (text: string): QueueIntent | null => {
  const t = text.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ")
  if (!t || t.split(/\s+/).length > 14) return null
  if (SHOW.test(t)) return { kind: "SHOW" }
  const rm = t.match(REMOVE)
  if (rm) return { kind: "REMOVE", name: rm[1]!.trim() }
  const w = t.match(WATCHED)
  if (w) return { kind: "WATCHED", name: w[1]!.replace(/^(?:the|a|an)\s+/i, "").trim() }
  return null
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
const tokens = (s: string): string[] => norm(s).split(" ").filter((w) => w.length >= 3)

// The one queued item the words point at (every word said is in its title); two are not guessed.
export const findQueueItem = <T extends { title: string }>(name: string, items: T[]): T | null => {
  const want = tokens(name)
  if (!want.length) return null
  const found = items.filter((i) => {
    const have = new Set(tokens(i.title))
    return want.every((w) => have.has(w))
  })
  return found.length === 1 ? found[0]! : null
}

export const duration = (minutes: number | null): string => {
  if (minutes === null) return "length unknown"
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  return minutes % 60 ? `${h} h ${minutes % 60} min` : `${h} h`
}

export const queueReply = (items: QueueItem[]): string => {
  if (!items.length) return 'Your watch later is empty. When you share a video or an article, choose "Watch later" and it waits here until you have time.'
  const shown = items.slice(0, 8).map((i) => `${i.title} (${duration(i.minutes)})`)
  return `Watch later (${items.length}): ${shown.join("; ")}${items.length > 8 ? `; and ${items.length - 8} more` : ""}.`
}

export const suggestionLine = (i: Pick<QueueItem, "title" | "minutes">): string => `You have time. Watch later: ${i.title} (${duration(i.minutes)})?`
