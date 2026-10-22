/* =====================================================================
   How a person wants Ally to be (ADR 0028). Two dials, both with a
   default that changes nothing:
   - focus: what Ally leads with (everything / just remembering / their
     goals / turning saves into steps / someone to talk to).
   - directness: how firmly Ally says "not now" and how blunt its words
     are (gentle / balanced / direct).
   Pure code: the prompt line, the phrases that set them from chat, and
   the advice filter. Nothing here talks to the database or the AI.
   ===================================================================== */

export const FOCUSES = ["ALL", "REMEMBER", "GOALS", "SAVES", "SUPPORT"] as const
export const DIRECTNESSES = ["GENTLE", "BALANCED", "DIRECT"] as const
export type Focus = (typeof FOCUSES)[number]
export type Directness = (typeof DIRECTNESSES)[number]

export const asFocus = (v: unknown): Focus => ((FOCUSES as readonly unknown[]).includes(v) ? (v as Focus) : "ALL")
export const asDirectness = (v: unknown): Directness => ((DIRECTNESSES as readonly unknown[]).includes(v) ? (v as Directness) : "BALANCED")

const FOCUS_LINES: Record<Focus, string> = {
  ALL: "",
  REMEMBER:
    "They mostly use you to remember and remind. Do exactly what they ask. Do not suggest goals, plans, habits or improvements unless they ask, and leave \"suggest\" empty.",
  GOALS: "They want you to lead with their goals: what to do now and what is behind this week. Keep chat about that.",
  SAVES: "They want you to turn what they watch and save into small steps. When they mention content, offer one concrete step from it.",
  SUPPORT: "They mostly want someone to talk to. Listen first, stay warm, and only create tasks or plans when they ask.",
}

const DIRECTNESS_LINES: Record<Directness, string> = {
  BALANCED: "",
  GENTLE: "Be gentle: soft wording, suggestions as options and never orders, never tell them something is wrong or that they should stop. Still honest, never false praise.",
  DIRECT:
    "Be direct: say it straight in few words, what is not working and what to do instead. No cushioning and no filler praise. Still no guilt or shaming, and they keep the last word.",
}

// Added to the chat prompt. Empty for the defaults, so nothing changes for anyone who never touched them.
export const styleForPrompt = (focus: Focus, directness: Directness): string =>
  [FOCUS_LINES[focus], DIRECTNESS_LINES[directness]].filter(Boolean).join(" ")

// Reminders-only people get no "better way" lectures either.
export const wantsAdvice = (focus: Focus): boolean => focus !== "REMEMBER" && focus !== "SUPPORT"

// ---- setting them by saying so ---------------------------------------------------
// Short, exact phrases only (code-first, plan 16 §9b). Anything longer goes to the AI as before.

// How much Ally starts on its own (ADR 0027): everything, briefing + wrap-up only, or only the reminders they set.
export type Proactivity = "NORMAL" | "QUIETER" | "SILENT"

export interface PreferenceIntent {
  directness?: Directness
  focus?: Focus
  proactivity?: Proactivity
}

const QUIETER_RE = /^(?:please\s+)?(?:be|go|get)\s+(?:a\s+bit\s+|a\s+little\s+)?quieter$|^quieter(?:\s+please)?$|^(?:please\s+)?(?:message|text|ping|nudge|notify)\s+me\s+less$|^(?:send|give)\s+me\s+(?:fewer|less)\s+(?:messages|notifications|nudges)$/i
const SILENT_RE = /^(?:please\s+)?(?:go|be)\s+silent$|^silent\s+mode(?:\s+on)?$|^(?:please\s+)?(?:stop|quit)\s+(?:messaging|texting|pinging|nudging|notifying)\s+me$|^(?:please\s+)?(?:don'?t|do not)\s+(?:message|text|ping|nudge|notify)\s+me$|^(?:no|stop)\s+(?:more\s+)?(?:messages|notifications)\s+from\s+(?:you|ally)$/i
const CHATTY_RE = /^(?:please\s+)?(?:message|ping|nudge|notify)\s+me\s+(?:normally|again|as\s+before)$|^(?:turn|switch)\s+(?:messages|notifications|nudges)\s+(?:back\s+)?on$|^normal\s+messages$/i

const DIRECT_RE = /^(?:please\s+)?(?:be|talk|speak)\s+(?:more\s+)?(?:direct|blunt|straight|strict|honest)(?:\s+(?:with|to)\s+me)?$|^don'?t\s+sugar\s?coat(?:\s+(?:it|things))?$/i
const GENTLE_RE = /^(?:please\s+)?(?:be|go|talk)\s+(?:more\s+)?(?:gentle|gently|softer|soft|easy|nicer)(?:\s+(?:with|on|to)\s+me)?$/i
const NORMAL_RE = /^(?:please\s+)?(?:talk|be|go)\s+(?:back\s+to\s+)?(?:normal(?:ly)?|balanced|like\s+before)$/i
const REMEMBER_RE = /^(?:i\s+)?(?:only|just)\s+want\s+(?:you\s+to\s+)?(?:reminders?|remind\s+me(?:\s+of\s+things)?|remember\s+things)$|^(?:only|just)\s+(?:reminders?|remind\s+me\s+of\s+things)$/i
const ALL_RE = /^(?:help|assist)\s+me\s+with\s+everything$|^(?:i\s+)?want\s+(?:all|everything)$/i

export const preferenceIntent = (text: string): PreferenceIntent | null => {
  const t = text.trim().replace(/[.!]+$/, "")
  if (!t || t.split(/\s+/).length > 8) return null
  if (DIRECT_RE.test(t)) return { directness: "DIRECT" }
  if (GENTLE_RE.test(t)) return { directness: "GENTLE" }
  if (NORMAL_RE.test(t)) return { directness: "BALANCED" }
  if (REMEMBER_RE.test(t)) return { focus: "REMEMBER" }
  if (ALL_RE.test(t)) return { focus: "ALL" }
  if (QUIETER_RE.test(t)) return { proactivity: "QUIETER" }
  if (SILENT_RE.test(t)) return { proactivity: "SILENT" }
  if (CHATTY_RE.test(t)) return { proactivity: "NORMAL" }
  return null
}

export const preferenceReply = (p: PreferenceIntent): string => {
  if (p.proactivity === "QUIETER") return "Okay. Just the morning briefing, the evening wrap-up and the Sunday review. Your reminders still come."
  if (p.proactivity === "SILENT") return "Okay. I'll stay quiet and only send the reminders you set. Say \"message me normally\" to turn the rest back on."
  if (p.proactivity === "NORMAL") return "Okay. Briefing, nudges, follow-ups and the wrap-up are back on."
  if (p.directness === "DIRECT") return "Okay. I'll say it straight. Tell me if it's too much and I'll ease off."
  if (p.directness === "GENTLE") return "Okay. I'll go gently, and I'll only suggest, never push."
  if (p.directness === "BALANCED") return "Okay. Back to my usual way of talking."
  if (p.focus === "REMEMBER") return "Okay. I'll just remember and remind, and keep goals and plans out of it unless you ask."
  return "Okay. I'll help with everything again."
}
