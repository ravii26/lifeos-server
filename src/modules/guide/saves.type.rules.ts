/* =====================================================================
   Any content → the right actions (Phase D slice D7, ADR 0044), the
   code half. The AI only says what kind of content a save is and which part
   of life it belongs to; THESE rules decide what Ally suggests for that kind
   (plan 16 §6b). Also here: reading an article's text out of HTML, sampling
   very long pasted text, estimating reading time, and spotting a page that
   could not be read (a login or paywall).
   ===================================================================== */

export const CONTENT_TYPES = ["WORKOUT", "RECIPE", "TUTORIAL", "COURSE", "BOOK", "MOTIVATION", "RECOMMENDATION", "PLACE", "MONEY", "PRODUCT", "NEWS", "FUN"] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

export const DOMAINS = ["career", "coding", "fitness", "food", "money", "mindset", "relationships", "travel", "fun", "learning", "other"] as const
export type Domain = (typeof DOMAINS)[number]

// What the sheet pre-selects. The person always chooses; nothing happens without a tap.
export type SuggestedChoice = "DO" | "LATER" | "LIFT" | "LIST" | "LET_GO"

export const cleanContentType = (v: unknown): ContentType | null => (typeof v === "string" && (CONTENT_TYPES as readonly string[]).includes(v.toUpperCase()) ? (v.toUpperCase() as ContentType) : null)
export const cleanDomain = (v: unknown): Domain => (typeof v === "string" && (DOMAINS as readonly string[]).includes(v.toLowerCase()) ? (v.toLowerCase() as Domain) : "other")

// Long things wait; small things to try are done; feel-good stays on the shelf; picks go on lists.
export const choiceFor = (type: ContentType, lengthMinutes: number | null): SuggestedChoice => {
  switch (type) {
    case "WORKOUT":
    case "RECIPE":
    case "MONEY":
    case "BOOK":
      return "DO"
    case "TUTORIAL":
      return lengthMinutes !== null && lengthMinutes > 30 ? "LATER" : "DO"
    case "COURSE":
    case "NEWS":
      return "LATER"
    case "MOTIVATION":
      return "LIFT"
    case "RECOMMENDATION":
    case "PLACE":
    case "PRODUCT":
      return "LIST"
    case "FUN":
      return "LET_GO"
  }
}

// Which list a LIST pick belongs on.
export const listFor = (type: ContentType, domain: Domain, text: string): string | null => {
  if (type === "PLACE") return "Places"
  if (type === "PRODUCT") return "Wishlist"
  if (type !== "RECOMMENDATION") return null
  if (/\b(book|novel|read|author|paperback|kindle)\b/i.test(text) || domain === "learning") return "Books"
  if (/\b(movie|film|series|show|netflix|documentary|watch)\b/i.test(text) || domain === "fun") return "Movies"
  return "Movies"
}

// One line saying what Ally suggests and why, in the person's words.
export const suggestionReason = (type: ContentType, choice: SuggestedChoice, listName: string | null): string => {
  switch (choice) {
    case "DO":
      return type === "WORKOUT" ? "A routine to try." : type === "RECIPE" ? "Something to cook." : type === "BOOK" ? "Ideas worth one small experiment." : type === "MONEY" ? "Something to look into." : "Something to try."
    case "LATER":
      return type === "COURSE" ? "Long: it waits until you have time." : type === "NEWS" ? "Good to know, nothing to do." : "Long enough to wait for a free evening."
    case "LIFT":
      return "Here to lift you, so it waits for the days you need it."
    case "LIST":
      return `A pick to keep${listName ? ` on your ${listName.toLowerCase()} list` : ""}.`
    case "LET_GO":
      return "Nothing to do here. Let it go?"
  }
}

// ---- reading time ----------------------------------------------------------------------------

export const readingMinutes = (text: string): number => Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 200))

// ---- long pasted text -----------------------------------------------------------------------------

export const FULL_READ_CHARS = 30_000
export const MAX_PASTE_CHARS = 100_000

// Up to 30,000 characters are read whole. Longer text is read in three parts (start, middle,
// end) and flagged, so the summary never claims to have read what it did not.
export const sampleLongText = (text: string): { text: string; sampled: boolean } => {
  if (text.length <= FULL_READ_CHARS) return { text, sampled: false }
  const part = Math.floor(FULL_READ_CHARS / 3)
  const mid = Math.floor(text.length / 2) - Math.floor(part / 2)
  return {
    text: `${text.slice(0, part)}\n[...]\n${text.slice(mid, mid + part)}\n[...]\n${text.slice(-part)}`,
    sampled: true,
  }
}

// ---- articles -------------------------------------------------------------------------------------------

const decode = (s: string): string =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))

// The readable text of a web page: the <article> (else <main>, else the body) with scripts, styles,
// navigation and forms removed, paragraphs and headings kept in order.
export const extractArticleText = (html: string): string => {
  let h = html.slice(0, 1_500_000)
  h = h.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
  const grab = (tag: string): string | null => h.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1] ?? null
  const region = grab("article") ?? grab("main") ?? grab("body") ?? h
  const blocks: string[] = []
  for (const m of region.matchAll(/<(p|h[1-4]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = decode(m[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
    if (t.length >= 25 || /^h/i.test(m[1]!)) blocks.push(t)
  }
  return blocks.join("\n").trim()
}

// A page behind a login or paywall gives a few lines at most; say so instead of summarising it.
export const looksBlocked = (text: string): boolean => text.length < 400 || /\b(subscribe to (?:continue|read)|sign in to (?:continue|read)|log in to (?:continue|read)|create a free account to read|you have reached your (?:free )?limit)\b/i.test(text.slice(0, 3000))

// ---- which links the server may fetch ------------------------------------------------------------------

// The server reads a page on the person's behalf, so it must never be pointed at the machine it runs
// on or at a private network. Only plain http(s) to a public host name or address is allowed.
export const isFetchableUrl = (raw: string): boolean => {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false
  if (u.username || u.password) return false
  if (u.port && u.port !== "80" && u.port !== "443") return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return false
  if (host.includes(":")) return false // IPv6 literals: not worth the risk
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])]
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false
  } else if (!host.includes(".")) {
    return false // a bare name like "metadata" or "intranet"
  }
  return true
}
