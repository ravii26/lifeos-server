/* =====================================================================
   The rest of the screens' buttons, by talking (plan 20, M4, ADR 0033):
   the Now card ("not now", "make it smaller", "I only did the minimum"),
   the too-much-today card ("move the extra to later"), tonight's prep
   ("I prepped the oats"), "low energy today", "make that memory private",
   and the account actions that chat must point to, never perform.
   Pure: it only reads the sentence. assistant.screen.service.ts acts.
   ===================================================================== */

export type ScreenIntent =
  | { kind: "NOT_NOW"; name: string | null } // null = the card on Now
  | { kind: "SMALLER" }
  | { kind: "MINIMUM"; name: string | null; minutes: number | null }
  | { kind: "MOVE_EXTRA" }
  | { kind: "PREP"; what: string }
  | { kind: "LOW_ENERGY"; on: boolean }
  | { kind: "PRIVATE"; what: string; value: boolean }
  | { kind: "ACCOUNT"; what: "SIGN_OUT" | "EXPORT" }
  | { kind: "SHELF_POINTER" } // saves are handled on the Saved screen, not by chat (yet)

const THAT = /^(?:it|that|this|them|those|these)$/i

const NOT_NOW = /^(?:ok(?:ay)?[, ]+)?(?:not now|not right now|not today|not tonight|skip (?:it|this|that)(?: for (?:today|now|tonight))?|pass on (?:it|this))$/i
const SKIP_NAMED = /^(?:please\s+)?skip\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:today|tonight|for\s+(?:today|now|tonight)))?$/i
const SMALLER = /^(?:ok(?:ay)?[, ]+)?(?:make it smaller|smaller(?: please)?|give me (?:a )?smaller(?: version)?|a smaller version|something smaller)$/i
const MINIMUM_A = /^(?:i\s+)?(?:only\s+|just\s+)?did\s+(?:the\s+)?(?:minimum|smallest(?:\s+version)?)(?:\s+(?:of|for|on)\s+(.+))?$/i
const MINIMUM_B = /^(?:i\s+)?(?:only|just)\s+(?:did|managed|got)\s+(?:in\s+)?(\d{1,3})\s*(?:min(?:ute)?s?)\s+(?:of\s+|on\s+|for\s+)?(.+)$/i
const MOVE_EXTRA = /^(?:please\s+)?(?:move|push)\s+(?:all\s+)?(?:the\s+)?(?:extra|rest|overflow|leftover|what (?:doesn'?t|does not) fit|too much)(?:\s+(?:stuff|things|tasks|to-?dos))?\s+(?:to\s+)?later$/i
const PREP = /^(?:i\s+)?(?:have\s+)?(?:prepped|prepared|soaked|packed|set\s+out|laid\s+out)\s+(?:the\s+|my\s+|for\s+)?(.+)$|^prep(?:aration)?\s+(?:is\s+)?done$/i
const LOW_ON = /^(?:i\s+(?:have|am on)\s+)?low[- ]energy(?:\s+(?:today|mode))?$|^(?:turn on|switch on|start)\s+low[- ]energy(?:\s+(?:mode|today))?$|^i(?:'m| am| have)\s+(?:very\s+)?low on energy(?:\s+today)?$|^no energy today$/i
const LOW_OFF = /^(?:back to|i have)\s+(?:full\s+)?energy(?:\s+now)?$|^(?:turn off|switch off|stop)\s+low[- ]energy(?:\s+mode)?$/i
const PRIVATE = /^(?:please\s+)?(?:make|mark|set|keep)\s+(?:my\s+|the\s+|that\s+)?(.+?)\s+(?:memory\s+)?(?:as\s+)?(private|not private|public)$/i
const SHELF = /^(?:please\s+)?(?:put|add|move|keep|save|file)\b.*\b(?:hard[- ]days?|comfort)\s+shelf$/i
const SIGN_OUT = /^(?:please\s+)?(?:sign|log)\s*(?:me\s+)?out(?:\s+of\s+ally)?$/i
const EXPORT = /^(?:please\s+)?(?:export|download|send me)\s+(?:all\s+)?(?:of\s+)?my\s+(?:data|info|information)$/i

export const screenIntent = (text: string): ScreenIntent | null => {
  const t = text.trim().replace(/[.!]+$/, "")
  if (!t || t.split(/\s+/).length > 12) return null

  if (SHELF.test(t)) return { kind: "SHELF_POINTER" }
  if (SIGN_OUT.test(t)) return { kind: "ACCOUNT", what: "SIGN_OUT" }
  if (EXPORT.test(t)) return { kind: "ACCOUNT", what: "EXPORT" }
  if (NOT_NOW.test(t)) return { kind: "NOT_NOW", name: null }
  if (SMALLER.test(t)) return { kind: "SMALLER" }
  if (MOVE_EXTRA.test(t)) return { kind: "MOVE_EXTRA" }
  if (LOW_OFF.test(t)) return { kind: "LOW_ENERGY", on: false }
  if (LOW_ON.test(t)) return { kind: "LOW_ENERGY", on: true }

  let m = t.match(MINIMUM_A)
  if (m) return { kind: "MINIMUM", name: m[1]?.trim() && !THAT.test(m[1].trim()) ? m[1].trim() : null, minutes: null }
  m = t.match(MINIMUM_B)
  if (m && !THAT.test(m[2]!.trim())) return { kind: "MINIMUM", name: m[2]!.trim(), minutes: Number(m[1]) }

  m = t.match(PRIVATE)
  if (m && !THAT.test(m[1]!.trim())) return { kind: "PRIVATE", what: m[1]!.trim(), value: m[2]!.toLowerCase() === "private" }

  m = t.match(PREP)
  if (m) return { kind: "PREP", what: (m[1] ?? "").trim() }

  m = t.match(SKIP_NAMED)
  if (m && !THAT.test(m[1]!.trim()) && m[1]!.trim().split(/\s+/).length <= 5) return { kind: "NOT_NOW", name: m[1]!.trim().replace(/^["']|["']$/g, "") }
  return null
}

export const ACCOUNT_TEXT = {
  SHELF: "Saves are sorted on the Saved screen, not by chat yet. Open Notes, then Saved, tap the save, and choose when it should come back. Anything you share to Ally lands there too.",
  SIGN_OUT: "I can't sign you out from chat. Open You, then Sign out at the bottom.",
  EXPORT: "I can't send your data from chat. Open You, then Account and data, and tap Export.",
}
