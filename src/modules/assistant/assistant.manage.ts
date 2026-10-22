/* =====================================================================
   Managing things by talking (plan 20, ADR 0030): "delete my gym habit",
   "pause the guitar goal", "rename passport to renew passport", "bring back
   my gym habit". Understood by code, so it is free, instant and always
   the same; the AI never picks an id.
   - Remove means archive: nothing is destroyed and every change has Undo.
   - A name that matches several things becomes a "which one?" question.
   - "All my habits" over BULK_ASK_OVER items asks for a yes first.
   Anything not clearly one of these goes on to the AI as before.
   This file is pure (no database); assistant.manage.service.ts acts.
   ===================================================================== */

export type Kind = "HABIT" | "TASK" | "REMINDER" | "PROJECT" | "NOTE" | "AREA"
export type Verb = "REMOVE" | "PAUSE" | "RESTORE" | "RENAME" | "KEEP"

export interface ManageIntent {
  verb: Verb
  // delete / remove / archive answer even when nothing matches; drop / cancel / "don't want X any more" stay quiet
  strong: boolean
  kind: Kind | null // named by the person ("habit", "reminder"), else any
  name: string // what they called it ("gym")
  all: boolean // "all my habits"
  raw?: string // the target as said, for a second try when a leading word was part of the name
  to?: string // RENAME: the new name
  confirmed?: number // "yes, remove all 7 habits": the count they said yes to
}

export const BULK_ASK_OVER = 3

// Titles travel in quotes in the commands the phone and the choices send, so "from", "to" and "as"
// inside a title never read as part of the sentence.
export const withoutQuotes = (t: string): string => t.replace(/"[^"]*"/g, " ")
export const quoted = (title: string): string => `"${title.replace(/"/g, "'")}"`

const KIND_WORDS = String.raw`habits?|tasks?|to-?dos?|reminders?|projects?|goals?|notes?|areas?`

const kindOf = (word: string): Kind => {
  const w = word.toLowerCase()
  if (w.startsWith("habit")) return "HABIT"
  if (w.startsWith("remind")) return "REMINDER"
  if (w.startsWith("project") || w.startsWith("goal")) return "PROJECT"
  if (w.startsWith("note")) return "NOTE"
  if (w.startsWith("area")) return "AREA"
  return "TASK"
}

export const kindLabel = (k: Kind, plural = false): string => {
  const s = { HABIT: "habit", TASK: "to-do", REMINDER: "reminder", PROJECT: "goal", NOTE: "note", AREA: "area" }[k]
  return plural ? `${s}s` : s
}

const REMOVE_STRONG = /^(?:please\s+)?(?:delete|remove|archive)\s+(.+)$/i
const REMOVE_WEAK = /^(?:please\s+)?(?:drop|scrap|cancel|get rid of|stop tracking)\s+(.+)$/i
const DONT_WANT = /^(?:i\s+)?(?:don'?t|do not)\s+(?:want|need)\s+(.+?)\s+any\s?more$/i
const PAUSE = /^(?:please\s+)?pause\s+(.+)$/i
const RESTORE = /^(?:please\s+)?(?:resume|restore|unarchive|reactivate|bring back|undelete)\s+(.+)$/i
const RENAME_QUOTED = /^(?:please\s+)?(?:rename|retitle)\s+((?:[a-z-]+:\s*)?"[^"]+")\s+(?:to|as)\s+(.+)$/i
const RENAME = /^(?:please\s+)?(?:rename|retitle)\s+(.+?)\s+(?:to|as)\s+(.+)$/i
const CONFIRM = new RegExp(String.raw`^yes[, ]+(?:remove|delete|archive|pause)\s+all\s+(\d+)\s+(${KIND_WORDS})$`, "i")
const NO_KEEP = /^no[, ]+keep\s+(?:them|it)$/i
const THAT = /^(?:it|that|this|them|those|these)$/i

// "the habit gym" / "gym habit" / "all my habits" / "habit: Gym session" → kind, name, all
export const readTarget = (raw: string): { kind: Kind | null; name: string; all: boolean; raw: string } => {
  let t = raw.trim().replace(/[.!?]+$/, "")
  let all = false
  t = t.replace(/^all\s+(?:of\s+)?(?:my\s+|the\s+)?/i, () => {
    all = true
    return ""
  })
  t = t.replace(/^(?:my|the|a|an)\s+/i, "")
  let kind: Kind | null = null
  const lead = t.match(new RegExp(String.raw`^(${KIND_WORDS})\b[:\s]*(?:called\s+|named\s+|for\s+|about\s+)?`, "i"))
  if (lead) {
    kind = kindOf(lead[1]!)
    const rest = t.slice(lead[0].length).trim()
    // "habits" alone, in the plural: every one of them
    if (rest === "" && /s$/i.test(lead[1]!)) all = true
    t = rest
  } else {
    const trail = t.match(new RegExp(String.raw`^(.+?)\s+(${KIND_WORDS})$`, "i"))
    if (trail) {
      kind = kindOf(trail[2]!)
      t = trail[1]!
    }
  }
  t = t.replace(/^(?:my|the)\s+/i, "").trim()
  const plain = raw.trim().replace(/[.!?]+$/, "").replace(/^(?:my|the|a|an)\s+/i, "").replace(/^["']|["']$/g, "").trim()
  return { kind, name: t.replace(/^["']|["']$/g, "").trim(), all, raw: plain }
}

export const manageIntent = (text: string): ManageIntent | null => {
  const t = text.trim().replace(/[.!]+$/, "")
  if (!t || t.split(/\s+/).length > 14) return null

  if (NO_KEEP.test(t)) return { verb: "KEEP", strong: false, kind: null, name: "", all: false }
  const yes = t.match(CONFIRM)
  if (yes) {
    const verbPause = /^yes[, ]+pause/i.test(t)
    return { verb: verbPause ? "PAUSE" : "REMOVE", strong: true, kind: kindOf(yes[2]!), name: "", all: true, confirmed: Number(yes[1]) }
  }

  // Sentences about changing an item's contents ("remove sugar from my diet note") belong to the AI,
  // but a quoted title ("Learn from mistakes") is just a name.
  if (/\bfrom\b/i.test(withoutQuotes(t))) return null

  const rn = t.match(RENAME_QUOTED) ?? t.match(RENAME)
  if (rn) {
    const target = readTarget(rn[1]!)
    const to = rn[2]!.trim().replace(/^["']|["']$/g, "").slice(0, 120)
    if (!target.name || THAT.test(target.name) || target.all || !to) return null
    return { verb: "RENAME", strong: true, kind: target.kind, name: target.name, all: false, to }
  }

  const pick = (re: RegExp, verb: Verb, strong: boolean): ManageIntent | null => {
    const m = t.match(re)
    if (!m) return null
    const target = readTarget(m[1]!)
    if (THAT.test(target.name)) return null // "delete it" is the follow-up undo
    if (!target.name && !target.all) return null
    return { verb, strong, ...target }
  }
  return (
    pick(REMOVE_STRONG, "REMOVE", true) ??
    pick(PAUSE, "PAUSE", true) ??
    pick(RESTORE, "RESTORE", true) ??
    pick(REMOVE_WEAK, "REMOVE", false) ??
    pick(DONT_WANT, "REMOVE", false)
  )
}

// ---- finding the thing by what they called it ----------------------------------

export interface Item {
  id: string
  kind: Kind
  title: string
}

export type Match = { type: "ONE"; item: Item } | { type: "MANY"; items: Item[] } | { type: "NONE" }

const STOP = new Set(["the", "my", "a", "an", "of", "to", "for", "and", "on", "in", "at", "with"])
const words = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w))

// "gym" matches "Gym session"; "pack" does not match "Gym session". Longer words match by their
// first four letters ("exercis" ~ "exercise"); short words must be equal.
const sameWord = (a: string, b: string) => (a.length >= 4 && b.length >= 4 ? a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)) : a === b)

// Every word they said must be in the title, so "gym bag" never finds "Gym session".
export const findItems = (name: string, items: Item[]): Match => {
  const want = words(name)
  if (!want.length) return { type: "NONE" }
  const exact = items.filter((i) => words(i.title).join(" ") === want.join(" "))
  if (exact.length === 1) return { type: "ONE", item: exact[0]! }
  if (exact.length > 1) return { type: "MANY", items: exact.slice(0, 5) }
  const found = items.filter((i) => {
    const have = words(i.title)
    return want.every((w) => have.some((h) => sameWord(w, h)))
  })
  if (found.length === 1) return { type: "ONE", item: found[0]! }
  if (found.length > 1) return { type: "MANY", items: found.slice(0, 5) }
  return { type: "NONE" }
}

// The text of a "which one?" choice. Tapping it sends it back as a message, so it
// must be something manageIntent understands and findItems matches exactly.
export const choiceText = (verb: Verb, item: Item): string => {
  const v = verb === "PAUSE" ? "Pause" : verb === "RESTORE" ? "Bring back" : "Remove"
  return `${v} ${kindLabel(item.kind)}: ${quoted(item.title)}`
}
