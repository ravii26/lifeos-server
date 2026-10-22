/* =====================================================================
   "Show me" by talking (plan 20, M3, ADR 0032): "show my habits",
   "what reminders do I have?", "list my goals", "what did I remove?".
   Pure: it only reads the sentence. assistant.manage.show.service.ts
   builds the list; the phone turns each row into tap actions that are
   ordinary commands (remove, pause, set, bring back).
   ===================================================================== */

export type ShowKind = "HABIT" | "TASK" | "REMINDER" | "PROJECT" | "AREA" | "NOTE"
export type ShowIntent = { what: "LIVE"; kind: ShowKind } | { what: "REMOVED" }

const PLURAL = String.raw`habits|to-?dos|tasks|reminders|goals|projects|areas|notes`

const kindOfPlural = (w: string): ShowKind => {
  const x = w.toLowerCase()
  if (x.startsWith("habit")) return "HABIT"
  if (x.startsWith("remind")) return "REMINDER"
  if (x.startsWith("goal") || x.startsWith("project")) return "PROJECT"
  if (x.startsWith("area")) return "AREA"
  if (x.startsWith("note")) return "NOTE"
  return "TASK"
}

const LIST_A = new RegExp(String.raw`^(?:please\s+)?(?:show|list|display|see|view)\s+(?:me\s+)?(?:all\s+)?(?:of\s+)?(?:my\s+|the\s+)?(${PLURAL})$`, "i")
const LIST_B = new RegExp(String.raw`^what\s+(?:are\s+)?(?:my|the)\s+(${PLURAL})(?:\s+(?:do\s+i\s+have|i\s+have))?$`, "i")
const LIST_C = new RegExp(String.raw`^(?:what|which)\s+(${PLURAL})\s+do\s+i\s+have$`, "i")
const LIST_D = new RegExp(String.raw`^my\s+(${PLURAL})$`, "i")
const ON_LIST = /^what(?:'s|\s+is)\s+on\s+my\s+(?:to-?do\s+)?list$/i

const REMOVED_A = /^(?:please\s+)?(?:show|list)\s+(?:me\s+)?(?:(?:my|the|all)\s+)*(?:removed|archived|deleted|paused)\s+(?:things|items|stuff)$/i
const REMOVED_B = /^what\s+(?:did|have)\s+i\s+(?:remove[d]?|delete[d]?|archive[d]?|pause[d]?)(?:\s+(?:recently|lately|before))?$/i
const REMOVED_C = /^(?:what|which)\s+(?:things\s+)?(?:can|could)\s+i\s+bring\s+back$/i

export const showIntent = (text: string): ShowIntent | null => {
  const t = text.trim().replace(/[.!?]+$/, "")
  if (!t || t.split(/\s+/).length > 9) return null
  if (REMOVED_A.test(t) || REMOVED_B.test(t) || REMOVED_C.test(t)) return { what: "REMOVED" }
  if (ON_LIST.test(t)) return { what: "LIVE", kind: "TASK" }
  const m = t.match(LIST_A) ?? t.match(LIST_B) ?? t.match(LIST_C) ?? t.match(LIST_D)
  return m ? { what: "LIVE", kind: kindOfPlural(m[1]!) } : null
}

export const MAX_ROWS = 15

export const listTitle = (kind: ShowKind | "REMOVED"): string =>
  ({ HABIT: "Your habits", TASK: "Your to-dos", REMINDER: "Your reminders", PROJECT: "Your goals", AREA: "Your areas", NOTE: "Your notes", REMOVED: "Removed or paused" })[kind]

export const emptyText = (kind: ShowKind | "REMOVED"): string =>
  ({
    HABIT: 'You have no habits yet. Say what you want to do every day, like "walk 20 minutes after dinner".',
    TASK: 'Your to-do list is empty. Tell me something to do and I\'ll add it.',
    REMINDER: 'You have no reminders coming up. Say "remind me to … tomorrow at 6".',
    PROJECT: 'You have no goals yet. Say "make me a plan to …" and I\'ll turn it into weekly targets.',
    AREA: 'You have no areas yet. Say "add an area called Health".',
    NOTE: 'You have no taught notes yet. Tell me something to keep, like your breakfast options.',
    REMOVED: "Nothing removed or paused in the last 90 days.",
  })[kind]

// "repeats weekly" from a repeat rule.
export const repeatWord = (rule: string | null | undefined): string | null => {
  if (!rule) return null
  const f = rule.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/)?.[1]
  return f ? { DAILY: "repeats daily", WEEKLY: "repeats weekly", MONTHLY: "repeats monthly", YEARLY: "repeats yearly" }[f]! : "repeats"
}
