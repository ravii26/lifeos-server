import { originOf } from "../firstrun/firstrun.rules.js"

/* =====================================================================
   Where a thing Ally saved from chat came from (5.0 #45 m). Same rule as
   first run: code decides, not the AI's word alone. It is "said" only when
   most of its wording is the person's own; anything else shows as Ally's idea
   with what it is for and one line of why. Nothing is dropped here, since the
   action has already happened; it is only labelled.
   ===================================================================== */

export type Origin = {
  origin: "SAID" | "IDEA"
  said?: string
  ideaFor?: string
  reason?: string
}

export const provenance = (
  message: string,
  a: { title?: string; collection?: string; suggested?: unknown; for?: unknown; detail?: unknown },
): Origin | Record<string, never> => {
  const title = (a.title?.trim() || a.collection?.trim() || "").slice(0, 120)
  if (!title || !message.trim()) return {}
  const o = originOf(message, { title, said: undefined, suggested: a.suggested, for: a.for, detail: a.detail })
  return {
    origin: o.origin ?? "SAID",
    ...(o.said && { said: o.said }),
    ...(o.ideaFor && { ideaFor: o.ideaFor }),
    ...(o.reason && { reason: o.reason }),
  }
}
