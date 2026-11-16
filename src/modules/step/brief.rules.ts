/* =====================================================================
   The "doing it" screen (ALLY.md 5.0 #43): for one step, where it came
   from, how to begin (a first two-minute move) and what done looks like.
   The AI may write the two lines; these rules check them and write them
   by plain code when no AI answers. Pure code.
   ===================================================================== */

export interface Brief {
  /** A first move that takes about two minutes. */
  begin: string
  /** What "done" looks like, so there is an end to reach. */
  done: string
  /** True when both lines were written by code, not the AI. */
  byCode: boolean
}

export interface BriefInput {
  title: string
  minutes: number | null
  /** The smaller version the person or Ally set, if any. */
  smaller: string | null
}

export const BRIEF_MAX = 160

const clean = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, BRIEF_MAX) : "")
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const sentence = (s: string) => {
  const t = s.replace(/[.!\s]+$/, "")
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : ""
}

/** Without AI: the smaller version is the way in; otherwise the plainest honest start. */
export const briefByCode = (i: BriefInput): Brief => {
  const title = i.title.trim().replace(/[.!\s]+$/, "")
  const begin = i.smaller?.trim() ? sentence(i.smaller) : "Get out what you need for it and do the first two minutes. Starting is the hard part."
  const done = i.minutes && i.minutes > 0 ? `You can say “${lower(title)}” is done, or you gave it ${i.minutes} minutes. Either counts.` : `You can say “${lower(title)}” is done.`
  return { begin, done, byCode: true }
}

/**
 * The AI's answer, kept only where it is usable. A line that is missing,
 * too short, or just the title again falls back to the plain one.
 */
export const checkBrief = (raw: unknown, i: BriefInput): Brief => {
  const plain = briefByCode(i)
  const o = (raw ?? {}) as Record<string, unknown>
  const same = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "") === i.title.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const ok = (s: string) => s.length >= 8 && !same(s)
  const begin = clean(o.begin)
  const done = clean(o.done)
  // A smaller version the person set is theirs: it stays the way in.
  const useBegin = !i.smaller?.trim() && ok(begin)
  const useDone = ok(done)
  return { begin: useBegin ? sentence(begin) : plain.begin, done: useDone ? sentence(done) : plain.done, byCode: !useBegin && !useDone }
}

export const briefPrompt = (i: BriefInput & { goal: string | null; why: string | null; area: string | null }): string =>
  [
    "Someone is about to start one step of their own plan. Help them begin. Return JSON only:",
    '{"begin":"the first physical move, doable in 2 minutes","done":"what finished looks like, one plain sentence"}',
    "Rules: plain everyday words, one sentence each, at most 25 words; concrete and specific to this step;",
    "no pep talk, no advice, no new tasks; do not invent facts about them; if the step is too vague to say, return empty strings.",
    `Step: ${i.title}${i.minutes ? ` (${i.minutes} min)` : ""}`,
    i.goal ? `It is part of: ${i.goal}${i.why ? ` (why: ${i.why})` : ""}` : "",
    i.area ? `Area of life: ${i.area}` : "",
  ]
    .filter(Boolean)
    .join("\n")

/** A clearer wording the AI offers for an unclear step: usable only if it is a real, different, short title. */
export const checkClearer = (raw: unknown, title: string): string | null => {
  const t = clean((raw as Record<string, unknown> | null)?.title).replace(/[.\s]+$/, "")
  if (t.length < 4 || t.length > 120) return null
  return t.toLowerCase() === title.trim().toLowerCase() ? null : t
}

export const clearerPrompt = (title: string, goal: string | null): string =>
  [
    "This step in someone's plan is not clear enough to start. Rewrite it as one concrete action they can begin today.",
    'Return JSON only: {"title":"the rewritten step, at most 12 words, starting with a verb"}',
    "Keep their meaning and their words where you can. Do not add a second task. If you cannot tell what they mean, return an empty title.",
    `Step: ${title}`,
    goal ? `It is part of: ${goal}` : "",
  ]
    .filter(Boolean)
    .join("\n")
