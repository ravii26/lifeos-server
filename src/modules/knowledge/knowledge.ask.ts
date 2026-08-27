import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { cosineSimilarity, embedText, embeddingsAvailable } from "../../lib/embeddings.js"
import {
  getUserNow,
  getUserLifeContext,
  formatLifeContextForPrompt,
  isLifeContextEmpty,
  type RagNow,
  type UserLifeContext,
} from "../../lib/rag.js"
import logger from "../../lib/logger.js"
import { findChunksForRetrieval } from "../document/document.repository.js"
import { findChunksForUser } from "./knowledge.repository.js"
import type { AskResultDto, AskSourceDto } from "./knowledge.dto.js"

const TOP_K = 5
const SNIPPET_LEN = 300

const NOTHING_AT_ALL_MSG =
  "You don't have any areas, goals, habits, tasks, or saved material yet — there's nothing for me to answer from."
const NOT_FOUND_MSG =
  "I couldn't find anything about that in your saved material or your current areas/goals/habits/tasks."

interface Candidate {
  sourceType: "DOCUMENT" | "NOTE" | "RESOURCE"
  sourceId: string
  sourceTitle: string
  heading: string | null
  content: string
  embedding: number[]
}

interface Ranked extends Candidate {
  score: number
}

// ── Retrieval ──────────────────────────────────────────────────────────────

// Keyword overlap — the fallback when embeddings are unavailable (no Gemini
// key). Scores a chunk by how many distinct query terms it contains.
const keywordScore = (terms: string[], content: string): number => {
  const lower = content.toLowerCase()
  return terms.reduce((n, term) => (lower.includes(term) ? n + 1 : n), 0)
}

const queryTerms = (question: string): string[] =>
  Array.from(
    new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3),
    ),
  )

const rank = async (question: string, candidates: Candidate[]): Promise<Ranked[]> => {
  if (embeddingsAvailable()) {
    try {
      const qVec = await embedText(question)
      return candidates
        .map((c) => ({ ...c, score: cosineSimilarity(qVec, c.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K)
    } catch (err) {
      logger.warn(
        `Question embedding failed, using keyword ranking: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const terms = queryTerms(question)
  return candidates
    .map((c) => ({ ...c, score: keywordScore(terms, c.content) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
}

// ── Answer generation ────────────────────────────────────────────────────────

const buildContext = (top: Ranked[]): string =>
  top
    .map((c, i) => `[${i + 1}] ${c.heading ? `${c.heading}\n` : ""}${c.content}`)
    .join("\n\n")

const SYSTEM_PROMPT = `You are the personal assistant inside LifeOS. Answer the user's question using the context provided below, which has two parts:

1. Numbered passages retrieved from the user's saved material (documents, notes, resources) — may be empty.
2. Their current life data: life areas, goals, habits, tasks, and in-progress learning resources — may be empty.

Rules:
- Base your answer strictly on what's given. Do not add outside facts, and do not invent areas/goals/habits/tasks that aren't listed.
- Prefer the life data for questions about the user's own state ("what are my goals", "what tasks are open in Fitness", "what habits am I tracking") — these questions don't need saved material to answer.
- Prefer the numbered passages for questions about specific content the user saved (a document's explanation, a note's detail).
- Combine both when relevant (e.g. "how much protein should I eat" might use a saved passage for the number and their Fitness goal/tasks for how it applies to them right now).
- If neither source has the answer, say so plainly — do not guess.
- Be concise and practical. Use the user's own wording where helpful.
- The current date/time is provided so you can reason about time-relative questions ("how long until…", "is this overdue", "which of these dates has passed") and resolve relative dates in the question ("today", "next week") against it. It is not itself a fact to report unless the question is about timing.
- Do not mention "passages", "context", or citation numbers in your reply; just answer naturally.`

const formatHistory = (history?: { role: "user" | "assistant"; text: string }[]): string => {
  if (!history || history.length === 0) return ""
  return history
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
    .join("\n")
}

const buildUserPrompt = (
  question: string,
  context: string,
  lifeContext: string,
  now: RagNow,
  historyText?: string,
): string => {
  const historyBlock = historyText ? `\n\nRecent conversation history:\n${historyText}\n` : ""
  return `Current date/time: ${now.isoDate} (${now.weekday}), ${now.timeOfDay}, timezone ${now.timezone}.\n\nSaved material passages:\n\n${context || "(none)"}\n\nCurrent life data:\n\n${lifeContext}${historyBlock}\n\nQuestion: ${question}`
}

const geminiAnswer = async (
  question: string,
  context: string,
  lifeContext: string,
  now: RagNow,
  historyText?: string,
): Promise<{ answer: string; usedAi: boolean }> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")
  const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL })
  const result = await model.generateContent([
    { text: SYSTEM_PROMPT },
    { text: buildUserPrompt(question, context, lifeContext, now, historyText) },
  ])
  const answer = result.response.text().trim()
  if (!answer) throw new Error("empty answer from Gemini")
  return { answer, usedAi: true }
}

const groqAnswer = async (
  question: string,
  context: string,
  lifeContext: string,
  now: RagNow,
  historyText?: string,
): Promise<{ answer: string; usedAi: boolean }> => {
  if (!groqClient) throw new Error("Groq client not initialized")
  const res = await groqClient.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(question, context, lifeContext, now, historyText) },
    ],
    model: "openai/gpt-oss-120b",
  })
  const answer = res.choices[0]?.message?.content?.trim() ?? ""
  if (!answer) throw new Error("empty answer from Groq")
  return { answer, usedAi: true }
}

const toSource = (c: Ranked): AskSourceDto => ({
  sourceType: c.sourceType,
  sourceId: c.sourceId,
  sourceTitle: c.sourceTitle,
  heading: c.heading,
  snippet: c.content.length > SNIPPET_LEN ? `${c.content.slice(0, SNIPPET_LEN)}…` : c.content,
  score: Math.round(c.score * 1000) / 1000,
})

// Retrieve the most relevant passages from the user's saved material, blend
// in their current life data (areas/goals/habits/tasks/resources), and answer
// the question from both (Gemini → Groq → heuristic). `documentId` scopes
// retrieval to a single document (Document-only, no Notes/Resources/life data
// mixed in — the user explicitly asked about one document); omit it to search
// everything: every READY Document, every embedded Note/Resource, and the
// user's live areas/goals/habits/tasks/resources, so the assistant can answer
// from the user's actual state without requiring anything to be uploaded.
export const runKnowledgeAsk = async (
  userId: string,
  question: string,
  documentId?: string,
  history?: { role: "user" | "assistant"; text: string }[],
): Promise<AskResultDto> => {
  const documentRows = await findChunksForRetrieval(userId, documentId)
  const documentCandidates: Candidate[] = documentRows.map((r) => ({
    sourceType: "DOCUMENT" as const,
    sourceId: r.documentId,
    sourceTitle: r.document.title,
    heading: r.heading,
    content: r.content,
    embedding: r.embedding,
  }))

  let candidates = documentCandidates
  let lifeContext: UserLifeContext | null = null
  if (!documentId) {
    const [knowledgeRows, life] = await Promise.all([
      findChunksForUser(userId),
      getUserLifeContext(userId),
    ])
    const knowledgeCandidates: Candidate[] = knowledgeRows.map((r) => ({
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      sourceTitle: r.sourceTitle,
      heading: r.heading,
      content: r.content,
      embedding: r.embedding,
    }))
    candidates = [...documentCandidates, ...knowledgeCandidates]
    lifeContext = life
  }

  if (candidates.length === 0 && (!lifeContext || isLifeContextEmpty(lifeContext))) {
    return { answer: NOTHING_AT_ALL_MSG, sources: [], usedAi: false }
  }

  const top = candidates.length > 0 ? await rank(question, candidates) : []
  const hasLifeData = lifeContext !== null && !isLifeContextEmpty(lifeContext)
  if (top.length === 0 && !hasLifeData) {
    return { answer: NOT_FOUND_MSG, sources: [], usedAi: false }
  }

  const context = buildContext(top)
  const lifeContextText = lifeContext ? formatLifeContextForPrompt(lifeContext) : "(not applicable — question scoped to one document)"
  // Only fetch the clock when we actually have an AI provider to reason with;
  // the verbatim-passage fallback below doesn't use it. Reuse the clock
  // already embedded in lifeContext when we have one, to avoid a second query.
  const now =
    lifeContext?.now ?? (geminiClient || groqClient ? await getUserNow(userId) : null)
  const historyText = formatHistory(history)
  const { answer, usedAi } = await runWithAiFallback(
    "Knowledge Q&A",
    {
      gemini: geminiClient && now ? () => geminiAnswer(question, context, lifeContextText, now, historyText) : undefined,
      groq: groqClient && now ? () => groqAnswer(question, context, lifeContextText, now, historyText) : undefined,
    },
    // No AI available: hand back the best-matching passage verbatim if there
    // is one; otherwise there's nothing verbatim to return for pure life-data
    // questions without an LLM to synthesise them into prose.
    () =>
      top.length > 0
        ? { answer: top[0]!.content, usedAi: false }
        : {
            answer:
              "AI is unavailable right now, so I can't summarise your current areas/goals/habits/tasks into an answer — but that data exists, try again shortly.",
            usedAi: false,
          },
  )

  return { answer, sources: top.map(toSource), usedAi }
}
