/* =====================================================================
   Assistant — the unified "Jarvis" persona. Rough pass: this is a thin
   orchestrator, not a new AI engine. It routes a message to whichever
   existing engine already answers it best, so there's exactly one
   endpoint/persona on the outside even though two engines still do the
   real work underneath (per the "unify, don't rebuild" plan).
   ===================================================================== */
import { getDecisionsService } from "../decisions/decisions.service.js"
import { runKnowledgeAsk } from "../knowledge/knowledge.ask.js"
import type { AskResultDto } from "../knowledge/knowledge.dto.js"
import type { DecisionResult } from "../decisions/decisions.ai.js"
import { createCaptureAndProcessSync } from "../capture/capture.service.js"

// Loose intent match for "what should I do" style messages — these get
// routed to the decisions/"What Now" engine instead of document/life-data
// Q&A, since that's the engine actually built to answer them.
const WHAT_NOW_PATTERN =
  /\b(what (should|do) i do|what'?s? next|what now|what should i (focus|work|do) on|help me (focus|decide))\b/i

// Intent pattern to detect when the user wants to add/capture/save/remember/remind/track/log something.
const CAPTURE_INTENT_PATTERN =
  /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(add|create|save|remember|remind|track|capture|write\s+down|note\s+down|put\s+down|log|record)\b/i

const decisionToAnswer = (d: DecisionResult): AskResultDto => {
  const lines: string[] = [d.briefing || d.headline]
  if (d.primaryAction) {
    lines.push(`Right now: ${d.primaryAction.title} — ${d.primaryAction.why}`)
  }
  const upNext = d.suggestions.slice(1, 3)
  if (upNext.length > 0) {
    lines.push(`After that: ${upNext.map((s) => s.title).join("; ")}`)
  }
  return {
    answer: lines.filter(Boolean).join("\n\n"),
    sources: [],
    usedAi: d.source === "ai",
  }
}

// A blank/greeting message ("hey", "") reads as "check in on me", not a
// question — route it to the proactive briefing rather than a Q&A miss.
const isGreetingOrEmpty = (s: string): boolean =>
  s.length === 0 || /^(hey|hi|hello|yo|sup)\b/i.test(s)

export const assistantAsk = async (
  userId: string,
  message: string,
  history?: { role: "user" | "assistant"; text: string }[],
): Promise<AskResultDto> => {
  const trimmed = message.trim()

  if (isGreetingOrEmpty(trimmed) || WHAT_NOW_PATTERN.test(trimmed)) {
    const decision = await getDecisionsService(userId)
    return decisionToAnswer(decision)
  }

  if (CAPTURE_INTENT_PATTERN.test(trimmed)) {
    const result = await createCaptureAndProcessSync(userId, trimmed)
    return {
      answer: result.summary,
      sources: [],
      usedAi: true,
    }
  }

  return runKnowledgeAsk(userId, trimmed, undefined, history)
}
