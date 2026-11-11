/* =====================================================================
   Which instructions a chat message gets (ADR 0045). Everyday actions
   (to-dos, reminders, habits, notes, search, feelings) are always there.
   Rare ones (goals and their progress, the weekly card, sick/busy mode, the
   work schedule, nightly nudges) and the patterns section come only when the
   message could need them, decided by plain rules on the words.

   The rare parts are moved to the END of the instructions, never removed
   from the middle: everything before them is the same text on every
   message, so the provider's prompt cache keeps discounting it.

   The rules lean towards including: a wrong "yes" costs a few hundred
   tokens, a wrong "no" could cost a missing action. Long messages (often
   several things at once) get everything.
   ===================================================================== */

export type Extra = "GOALS" | "WEEK" | "MODE" | "SCHEDULE" | "NUDGE" | "PATTERNS"

// Which action types belong to each optional group.
export const EXTRA_ACTIONS: Record<Exclude<Extra, "PATTERNS">, string[]> = {
  GOALS: ["WHERE_I_STAND", "LOG_PROGRESS", "SET_PROJECT_STATUS", "ADD_PROJECT"],
  WEEK: ["WEEK_CARD"],
  MODE: ["SET_MODE"],
  SCHEDULE: ["SET_SCHEDULE"],
  NUDGE: ["SET_NUDGE"],
}

const GOAL_WORDS =
  /\b(?:goals?|projects?|progress|stand|how am i doing|how is my|pause|resume|drop|abandon|let (?:it|that) go|finished|completed|solved|practi[sc]ed?|did \d+|\d+ (?:problems|pages|km|kg|minutes|hours)|weigh|weight|milestone|stage|want to|wanna|plan(?:ning)? to|i will|going to|become|crack|switch|learn|prepare|preparation|exam|deadline|by (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|in \d+ (?:days|weeks|months|years)|this year|next year|chahta|chahti|seekhna|banna)\b/i
const WEEK_WORDS = /\b(?:week|weekly|review|hafte)\b/i
const MODE_WORDS =
  /\b(?:sick|ill|fever|cold|unwell|not well|busy|swamped|travel(?:l?ing)?|trip|holiday|vacation|leave|off till|better now|feeling better|normal|back to|recovered|bimar|bukhar|tabiyat|chutti|safar)\b/i
const SCHEDULE_WORDS =
  /\b(?:work(?:ing)?|office|college|school|class(?:es)?|tuition|gym|shift|job|schedule|wake|sleep|commute|weekdays?|weekends?|kaam|naukri|subah|shaam|raat)\b/i
const NUDGE_WORDS = /\b(?:nudges?|nightly|every (?:night|morning|evening)|stop (?:the )?(?:reminders|nudges)|morning reminder)\b/i
const DOUBT_WORDS = /\b(?:should i|what if|not sure|confused|perfect plan|which one|kya karu|samajh nahi)\b/i

// Past this length a message usually holds several things: send everything.
const LONG_MESSAGE = 160

export const extrasFor = (message: string, opts: { hasProjects: boolean; hasPatterns: boolean }): Set<Extra> => {
  const all: Extra[] = ["GOALS", "WEEK", "MODE", "SCHEDULE", "NUDGE", "PATTERNS"]
  if (message.length > LONG_MESSAGE) return new Set(all.filter((e) => e !== "PATTERNS" || opts.hasPatterns || DOUBT_WORDS.test(message)))
  const out = new Set<Extra>()
  if (GOAL_WORDS.test(message) || (opts.hasProjects && /\d/.test(message))) out.add("GOALS")
  if (WEEK_WORDS.test(message)) out.add("WEEK")
  if (MODE_WORDS.test(message)) out.add("MODE")
  if (SCHEDULE_WORDS.test(message)) out.add("SCHEDULE")
  if (NUDGE_WORDS.test(message)) out.add("NUDGE")
  if (opts.hasPatterns || DOUBT_WORDS.test(message)) out.add("PATTERNS")
  return out
}

const actionTypeOf = (line: string): string | null => line.match(/^- \{"type":"([A-Z_]+)"/)?.[1] ?? null

// Moves the optional actions and the patterns section to the end, keeping only
// the ones this message needs. The text before them is identical every time.
export const assemblePrompt = (full: string, extras: Set<Extra>): string => {
  const wanted = new Set<string>()
  for (const [group, types] of Object.entries(EXTRA_ACTIONS) as [Exclude<Extra, "PATTERNS">, string[]][]) {
    if (extras.has(group)) types.forEach((t) => wanted.add(t))
  }
  const optional = new Set(Object.values(EXTRA_ACTIONS).flat())

  const kept: string[] = []
  const moved: string[] = []
  const patterns: string[] = []
  let inPatterns = false
  for (const line of full.split("\n")) {
    if (line.startsWith("Patterns (")) inPatterns = true
    if (inPatterns) {
      if (line.trim() === "") {
        inPatterns = false
      } else {
        patterns.push(line)
        continue
      }
    }
    const type = actionTypeOf(line)
    if (type && optional.has(type)) {
      if (wanted.has(type)) moved.push(line)
      continue
    }
    kept.push(line)
  }

  const tail: string[] = []
  if (moved.length) tail.push("More actions you can use for this message:", ...moved)
  if (extras.has("PATTERNS") && patterns.length) tail.push(...(tail.length ? [""] : []), ...patterns)
  return tail.length ? `${kept.join("\n").trimEnd()}\n\n${tail.join("\n")}` : kept.join("\n")
}
