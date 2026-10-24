/* =====================================================================
   Lists and shopping (plan 16 §6, Phase D slice D2, ADR 0039), decided by
   code, no AI: "add milk to shopping", "got the milk", "untick milk",
   "remove milk from shopping", "clear what I got", "show shopping".
   A list is a LIST note; ticked items are kept in `done`. Anything that
   does not clearly name one of the person's lists (or a well-known one
   like shopping or movies) returns null, so the AI and the other
   handlers decide as before.
   ===================================================================== */

export type ListIntent =
  | { kind: "ADD"; items: string[]; list: string }
  | { kind: "TICK"; items: string[]; list: string | null }
  | { kind: "UNTICK"; items: string[]; list: string | null }
  | { kind: "REMOVE"; items: string[]; list: string }
  | { kind: "CLEAR"; list: string | null; what: "TICKED" | "ALL" } // list null = the shopping list
  | { kind: "SHOW"; list: string }
  // Routines (D4): "my gym routine: bench press 3x10, squats 3x8" and "start my gym routine" (untick all).
  | { kind: "SET_ROUTINE"; name: string; items: string[] }
  | { kind: "RESET"; list: string }

export interface ListNote {
  id: string
  collection: string
  title: string
  items: string[]
  done: string[]
}

const MAX_WORDS = 18

const WELL_KNOWN: { collection: string; title: string; names: string[] }[] = [
  { collection: "Shopping", title: "Shopping list", names: ["shopping", "shopping list", "grocery", "groceries", "grocery list", "groceries list"] },
  { collection: "Movies", title: "Movies to watch", names: ["movies", "movie", "movie list", "movies to watch", "watchlist", "watch list"] },
  { collection: "Books", title: "Books to read", names: ["books", "book list", "books to read", "reading list"] },
  { collection: "Bucket list", title: "Bucket list", names: ["bucket list", "bucketlist"] },
]

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
const stem = (w: string): string => w.replace(/(?:es|s)$/, "")
const tokens = (s: string): string[] => norm(s).split(" ").filter((w) => w.length >= 2).map(stem)
const stripList = (s: string): string => norm(s).replace(/\s+(?:list|routine)$/, "").trim()

export const wellKnownList = (name: string): { collection: string; title: string } | null => {
  const n = norm(name)
  const hit = WELL_KNOWN.find((w) => w.names.includes(n))
  return hit ? { collection: hit.collection, title: hit.title } : null
}

// The person's list a name points at: the exact collection / title, then a well-known
// name ("groceries" -> Shopping), then a list whose words contain every word said.
export const resolveList = <T extends ListNote>(name: string, notes: T[]): T | null => {
  const n = stripList(name)
  if (!n) return null
  const known = wellKnownList(name) ?? wellKnownList(n)
  const exact = notes.find((l) => stripList(l.collection) === n || stripList(l.title) === n)
  if (exact) return exact
  if (known) {
    const byKnown = notes.find((l) => norm(l.collection) === norm(known.collection))
    if (byKnown) return byKnown
  }
  const want = tokens(n)
  if (!want.length) return null
  const found = notes.filter((l) => {
    const have = new Set([...tokens(l.collection), ...tokens(l.title)])
    return want.every((w) => have.has(w))
  })
  return found.length === 1 ? found[0]! : null
}

// "milk, eggs and bread" -> ["Milk", "Eggs", "Bread"]
export const splitItems = (s: string): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of s.split(/\s*(?:,|&|\band\b|\+)\s*/i)) {
    const t = part.replace(/^(?:the|some|a|an)\s+/i, "").replace(/[.!?]+$/g, "").trim()
    if (t.length < 2 || t.length > 80 || seen.has(norm(t))) continue
    seen.add(norm(t))
    out.push(t.charAt(0).toUpperCase() + t.slice(1))
  }
  return out.slice(0, 20)
}

const ADD = /^(?:please\s+)?(?:add|put)\s+(.{2,200}?)\s+(?:to|on|onto|in|into)\s+(?:my\s+|the\s+)?(.{2,40})$/i
const OUT_OF = /^(?:we(?:'re| are)|i(?:'m| am)|we|i)?\s*(?:out of|ran out of|run out of|running low on|low on)\s+(.{2,100})$/i
const TICK_GOT = /^(?:i\s+)?(?:got|bought|picked up|grabbed|ordered|already have)\s+(?:the\s+)?(.{2,120})$/i
const TICK_SEEN = /^(?:i\s+)?(?:watched|saw|read|finished reading)\s+(.{2,80})$/i
const TICK_WORD = /^(?:tick|check|cross)\s+(?:off\s+)?(.{2,120}?)(?:\s+(?:from|on|in|off)\s+(?:my\s+|the\s+)?(.{2,40}))?$/i
const UNTICK = /^(?:untick|uncheck|un-tick|un-check)\s+(.{2,120}?)(?:\s+(?:from|on|in)\s+(?:my\s+|the\s+)?(.{2,40}))?$/i
const REMOVE = /^(?:please\s+)?(?:remove|delete|take)\s+(.{2,120}?)\s+(?:from|off)\s+(?:my\s+|the\s+)?(.{2,40})$/i
const CLEAR_TICKED = /^clear\s+(?:what i(?:'ve)? got|what i bought|(?:the\s+)?ticked(?: items)?|(?:the\s+)?done(?: items)?|(?:the\s+)?bought(?: items)?)(?:\s+(?:from|on|in)\s+(?:my\s+|the\s+)?(.{2,40}))?$/i
const CLEAR_ALL = /^(?:clear|empty|reset)\s+(?:out\s+)?(?:my\s+|the\s+)?(.{2,40})$/i
const SHOW = /^(?:show|open|see|list|read out)\s+(?:me\s+)?(?:my\s+|the\s+)?(.{2,40})$/i
const TICK_DONE = /^(?:done|did|finished|completed|ticked)\s+(?:with\s+|the\s+)?(.{2,80})$/i
const SET_ROUTINE = /^(?:set\s+)?(?:my\s+)?(.{2,30}?)\s+routine\s*(?:is|:|-|=)\s*(.{3,400})$/i
const RESET = /^(?:reset|restart|start over|start)\s+(?:my\s+|the\s+)?(.{2,30}?)\s+(?:routine|list)$/i
const ROUTINE_ALONE = /^(?:my\s+)?(.{2,30}?)\s+routine$/i
const WHATS_ON = /^what(?:'s| is)\s+(?:on|in)\s+(?:my\s+|the\s+)?(.{2,40})$/i

export const listIntent = (text: string): ListIntent | null => {
  const t = text.trim().replace(/[.!]+$/, "").replace(/\s+/g, " ")
  if (!t || t.split(/\s+/).length > MAX_WORDS) return null

  const sr = t.match(SET_ROUTINE)
  if (sr) return { kind: "SET_ROUTINE", name: stripList(sr[1]!), items: splitItems(sr[2]!) }
  const rs = t.match(RESET)
  if (rs) return { kind: "RESET", list: stripList(rs[1]!) }
  const ct = t.match(CLEAR_TICKED)
  if (ct) return { kind: "CLEAR", list: ct[1] ? stripList(ct[1]) : null, what: "TICKED" }
  const un = t.match(UNTICK)
  if (un) return { kind: "UNTICK", items: splitItems(un[1]!), list: un[2] ? stripList(un[2]) : null }
  const rm = t.match(REMOVE)
  if (rm) return { kind: "REMOVE", items: splitItems(rm[1]!), list: stripList(rm[2]!) }
  const add = t.match(ADD)
  if (add) return { kind: "ADD", items: splitItems(add[1]!), list: stripList(add[2]!) }
  const out = t.match(OUT_OF)
  if (out && !/\b(?:time|energy|ideas?|patience|steam|motivation|money)\b/i.test(out[1]!)) return { kind: "ADD", items: splitItems(out[1]!), list: "shopping" }
  const tw = t.match(TICK_WORD)
  if (tw) return { kind: "TICK", items: splitItems(tw[1]!), list: tw[2] ? stripList(tw[2]) : null }
  const got = t.match(TICK_GOT) ?? t.match(TICK_SEEN) ?? t.match(TICK_DONE)
  if (got) return { kind: "TICK", items: splitItems(got[1]!), list: null }
  const whats = t.match(WHATS_ON)
  if (whats) return { kind: "SHOW", list: stripList(whats[1]!) }
  const show = t.match(SHOW)
  if (show) return { kind: "SHOW", list: stripList(show[1]!) }
  const alone = t.match(ROUTINE_ALONE)
  if (alone && !/^(?:show|open|see|what|reset|restart|start)\b/i.test(alone[1]!)) return { kind: "SHOW", list: stripList(alone[1]!) }
  const ca = t.match(CLEAR_ALL)
  if (ca) return { kind: "CLEAR", list: stripList(ca[1]!), what: "ALL" }
  return null
}

// ---- items ---------------------------------------------------------------------------

// The one item of this list that the words point at: exact first, then the item that
// contains every word said. More than one match is not guessed.
export const findListItem = (name: string, items: string[]): string | null => {
  const n = norm(name)
  const exact = items.filter((i) => norm(i) === n)
  if (exact.length === 1) return exact[0]!
  const want = tokens(name)
  if (!want.length) return null
  const found = items.filter((i) => {
    const have = new Set(tokens(i))
    return want.every((w) => have.has(w))
  })
  return found.length === 1 ? found[0]! : null
}

export const openItems = (note: Pick<ListNote, "items" | "done">): string[] => note.items.filter((i) => !note.done.includes(i))

// ---- words ---------------------------------------------------------------------------

const join = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`)

export const addedReply = (title: string, added: string[], already: string[], total: number): string => {
  if (!added.length) return `${join(already)} ${already.length === 1 ? "is" : "are"} already on your ${title.toLowerCase()}.`
  const dup = already.length ? ` (${join(already)} ${already.length === 1 ? "was" : "were"} already there.)` : ""
  return `Added ${join(added)} to your ${title.toLowerCase()}.${dup} ${total} ${total === 1 ? "item" : "items"} now.`
}

export const tickedReply = (title: string, ticked: string[], openLeft: number): string =>
  `Got ${join(ticked)}. ${openLeft === 0 ? `Your ${title.toLowerCase()} is all ticked off.` : `${openLeft} left on your ${title.toLowerCase()}.`}`

export const showReply = (title: string, note: Pick<ListNote, "items" | "done">): string => {
  const open = openItems(note)
  const got = note.items.filter((i) => note.done.includes(i))
  if (!note.items.length) return `Your ${title.toLowerCase()} is empty. Say "add milk to ${title.toLowerCase()}" to start it.`
  const head = open.length ? `${title} (${open.length} to go): ${open.join(", ")}.` : `${title}: everything is ticked off.`
  return got.length ? `${head} Got: ${got.join(", ")}.` : head
}
