/* =====================================================================
   People (Phase D slice D5, ADR 0042), decided by code, no AI:
   "Mom's birthday is 12 March" (a yearly reminder), "Priya's number is
   98765 43210", "call Priya", "WhatsApp Rahul", "what's Priya's number",
   "when is Mom's birthday", "my people". A person is an INFO note in the
   collection "People"; the phone number and birthday live in its `meta`,
   which no search or AI prompt ever reads. Anything that does not name a
   saved person returns null so the other handlers decide ("call mom
   tomorrow at 9" stays a to-do).
   ===================================================================== */

export type PersonIntent =
  | { kind: "BIRTHDAY"; name: string; month: number; day: number }
  | { kind: "PHONE"; name: string; phone: string }
  | { kind: "CONTACT"; mode: "CALL" | "WHATSAPP"; name: string }
  | { kind: "SHOW"; name: string; what: "PHONE" | "BIRTHDAY" | "ALL" }
  | { kind: "LIST" }

export interface PersonMeta {
  phone?: string
  birthday?: { month: number; day: number }
}

export interface PersonNote {
  id: string
  title: string
  meta: PersonMeta | null
}

const MAX_WORDS = 16
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()

// "12 March", "12th march", "March 12", "3 jun", "12/03" (day first, as written in India)
export const parseDayMonth = (text: string): { month: number; day: number } | null => {
  const t = norm(text).replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, "$1").replace(/\bof\b/g, " ").replace(/\s+/g, " ").trim()
  const monthIndex = (w: string): number => MONTHS.findIndex((m) => m === w || (w.length >= 3 && m.startsWith(w)))
  let month = -1
  let day = 0
  let m = t.match(/^(\d{1,2}) ([a-z]{3,9})$/)
  if (m) {
    day = Number(m[1])
    month = monthIndex(m[2]!)
  }
  if (!m || month < 0) {
    m = t.match(/^([a-z]{3,9}) (\d{1,2})$/)
    if (m) {
      day = Number(m[2])
      month = monthIndex(m[1]!)
    }
  }
  if (month < 0) {
    const n = text.trim().match(/^(\d{1,2})[/.-](\d{1,2})$/)
    if (n) {
      day = Number(n[1])
      month = Number(n[2]) - 1
    }
  }
  if (month < 0 || month > 11 || day < 1 || day > DAYS_IN[month]!) return null
  return { month: month + 1, day }
}

const PHONE_NUM = "(\\+?\\d[\\d\\s\\-()]{6,17}\\d)"
const NAME = "(.{1,40}?)"

// 7 to 15 digits, a leading + kept.
export const cleanPhone = (raw: string): string | null => {
  const plus = raw.trim().startsWith("+")
  const digits = raw.replace(/\D/g, "")
  if (digits.length < 7 || digits.length > 15) return null
  return `${plus ? "+" : ""}${digits}`
}

const BIRTHDAY = new RegExp(`^(?:remember\\s+(?:that\\s+)?)?${NAME}(?:'s|s')?\\s+birthday\\s*(?:is\\s+|on\\s+|:\\s*|-\\s*)?(.{3,30})$`, "i")
const WHEN_BIRTHDAY = new RegExp(`^when(?:'s| is)\\s+${NAME}(?:'s|s')?\\s+birthday$`, "i")
const PHONE_SET = new RegExp(`^(?:(?:save|add|set|store)\\s+)?${NAME}(?:'s|s')?\\s+(?:phone\\s+)?(?:number|phone|mobile|contact)\\s*(?:as\\s+|is\\s+|:\\s*|=\\s*|-\\s*)?${PHONE_NUM}$`, "i")
const PHONE_ASK = new RegExp(`^(?:what(?:'s| is)|show|give me)\\s+${NAME}(?:'s|s')?\\s+(?:phone\\s+)?(?:number|phone|mobile)$`, "i")
const CALL = new RegExp(`^(?:call|phone|ring|dial)\\s+${NAME}$`, "i")
const WHATSAPP = new RegExp(`^(?:whatsapp|message|msg|text)\\s+${NAME}(?:\\s+on\\s+whatsapp)?$`, "i")
const WHO = new RegExp(`^(?:who is|show|tell me about)\\s+${NAME}$`, "i")
const PEOPLE = /^(?:show\s+)?(?:my\s+)?(?:people|contacts|birthdays)$/i

const SELF = new Set(["my", "me", "i", "mine", "your", "ur"])

const cleanName = (s: string): string => s.replace(/^(?:my|the)\s+/i, "").replace(/[?.!,]+$/g, "").replace(/\s+/g, " ").trim()

export const personIntent = (text: string): PersonIntent | null => {
  const t = text.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ")
  if (!t || t.split(/\s+/).length > MAX_WORDS) return null

  if (PEOPLE.test(t)) return { kind: "LIST" }
  const wb = t.match(WHEN_BIRTHDAY)
  if (wb) return { kind: "SHOW", name: cleanName(wb[1]!), what: "BIRTHDAY" }
  const pa = t.match(PHONE_ASK)
  if (pa) return { kind: "SHOW", name: cleanName(pa[1]!), what: "PHONE" }
  const ps = t.match(PHONE_SET)
  if (ps) {
    const phone = cleanPhone(ps[2]!)
    if (phone) return { kind: "PHONE", name: cleanName(ps[1]!), phone }
  }
  const bd = t.match(BIRTHDAY)
  if (bd) {
    const when = parseDayMonth(bd[2]!)
    const who = cleanName(bd[1]!)
    // "My birthday is 5 June" is about the person, not someone to keep: a memory, left to the AI.
    if (when && !SELF.has(norm(who))) return { kind: "BIRTHDAY", name: who, ...when }
  }
  const call = t.match(CALL)
  if (call) return { kind: "CONTACT", mode: "CALL", name: cleanName(call[1]!) }
  const wa = t.match(WHATSAPP)
  if (wa) return { kind: "CONTACT", mode: "WHATSAPP", name: cleanName(wa[1]!) }
  const who = t.match(WHO)
  if (who) return { kind: "SHOW", name: cleanName(who[1]!), what: "ALL" }
  return null
}

// ---- who is meant --------------------------------------------------------------------------

const ALIASES = [["mom", "mother", "mum", "mummy", "maa", "mama"], ["dad", "father", "papa", "pappa", "daddy"]]
const sameName = (a: string, b: string): boolean => {
  const x = norm(a)
  const y = norm(b)
  if (x === y) return true
  return ALIASES.some((g) => g.includes(x) && g.includes(y))
}

// The one saved person this name points at: the whole name, a nickname group (mom / mother),
// or a first name that only one person has. Two matches are not guessed.
export const findPerson = <T extends PersonNote>(name: string, people: T[]): T | null => {
  const exact = people.filter((p) => sameName(p.title, name))
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) return null
  const first = norm(name)
  if (!first) return null
  const partial = people.filter((p) => norm(p.title).split(" ").includes(first) || first.split(" ").every((w) => norm(p.title).split(" ").includes(w)))
  return partial.length === 1 ? partial[0]! : null
}

export const displayName = (name: string): string => cleanName(name).split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")

// ---- links the phone opens ---------------------------------------------------------------------

// A 10-digit number with no country code is taken as Indian when the person's timezone is.
export const dialNumber = (phone: string, tz: string): string => {
  const digits = phone.replace(/\D/g, "")
  if (!phone.startsWith("+") && digits.length === 10 && tz === "Asia/Kolkata") return `+91${digits}`
  return phone.startsWith("+") ? `+${digits}` : digits
}

export const contactUrl = (mode: "CALL" | "WHATSAPP", phone: string, tz: string): string => {
  const num = dialNumber(phone, tz)
  return mode === "CALL" ? `tel:${num}` : `https://wa.me/${num.replace(/\D/g, "")}`
}

// ---- words -----------------------------------------------------------------------------------------

const monthName = (m: number): string => MONTHS[m - 1]!.charAt(0).toUpperCase() + MONTHS[m - 1]!.slice(1)
export const dateWords = (b: { month: number; day: number }): string => `${b.day} ${monthName(b.month)}`

export const maskPhone = (phone: string): string => `ending ${phone.replace(/\D/g, "").slice(-4)}`

export const personLine = (p: PersonNote): string => {
  const bits = [p.meta?.birthday ? `birthday ${dateWords(p.meta.birthday)}` : null, p.meta?.phone ? "number saved" : null].filter(Boolean)
  return bits.length ? `${p.title} (${bits.join(", ")})` : p.title
}

export const listReply = (people: PersonNote[]): string =>
  people.length
    ? `People (${people.length}): ${people.map(personLine).join("; ")}.`
    : `You haven't saved anyone yet. Try "Mom's birthday is 12 March" or "Priya's number is 98765 43210".`
