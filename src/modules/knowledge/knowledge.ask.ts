import { geminiClient } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { cosineSimilarity, embedText, embeddingsAvailable } from "../../lib/embeddings.js"
import { getUserNow, type RagNow } from "../../lib/rag.js"
import logger from "../../lib/logger.js"
import { findChunksForRetrieval } from "../document/document.repository.js"
import { findChunksForUser } from "./knowledge.repository.js"
import type { AskResultDto, AskSourceDto } from "./knowledge.dto.js"

const TOP_K = 5
const SNIPPET_LEN = 300

const NO_MATERIAL_MSG =
  "You don't have any ingested documents, notes, or resources yet. Add some, then ask again."
const NOT_FOUND_MSG =
  "I couldn't find anything about that in your saved material."

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

const SYSTEM_PROMPT = `You are the study assistant inside LifeOS, a personal operating system. Answer the user's question using ONLY the numbered context passages, which come from the user's own saved material (documents, notes, and resources).

Rules:
- Base your answer strictly on the passages. Do not add outside facts.
- If the passages don't contain the answer, say you couldn't find it in their saved material — do not guess.
- Be concise and practical. Use the user's own wording where helpful.
- The current date/time is provided only so you can reason about time-relative questions ("how long until…", "is this still upcoming", "which of these dates has passed"). It is NOT a fact from their material — never introduce it as new content, and only reference it when the question is actually about timing. Resolve any relative date in the question ("today", "next week") against it.
- Do not mention "passages", "context", or citation numbers in your reply; just answer naturally.`

const buildUserPrompt = (question: string, context: string, now: RagNow): string =>
  `Current date/time: ${now.isoDate} (${now.weekday}), ${now.timeOfDay}, timezone ${now.timezone}.\n\nContext passages:\n\n${context}\n\nQuestion: ${question}`

const geminiAnswer = async (question: string, context: string, now: RagNow): Promise<{ answer: string; usedAi: boolean }> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")
  const model = geminiClient.getGenerativeModel({ model: "gemini-2.0-flash" })
  const result = await model.generateContent([
    { text: SYSTEM_PROMPT },
    { text: buildUserPrompt(question, context, now) },
  ])
  const answer = result.response.text().trim()
  if (!answer) throw new Error("empty answer from Gemini")
  return { answer, usedAi: true }
}

const groqAnswer = async (question: string, context: string, now: RagNow): Promise<{ answer: string; usedAi: boolean }> => {
  if (!groqClient) throw new Error("Groq client not initialized")
  const res = await groqClient.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(question, context, now) },
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

// Retrieve the most relevant passages from the user's saved material and answer
// the question from them (Gemini → Groq → verbatim-passage heuristic).
// `documentId` scopes to a single document exactly as before (Document-only,
// no Notes/Resources mixed in); omit it to search everything — every READY
// Document plus every embedded Note and Resource.
export const runKnowledgeAsk = async (
  userId: string,
  question: string,
  documentId?: string,
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
  if (!documentId) {
    const knowledgeRows = await findChunksForUser(userId)
    const knowledgeCandidates: Candidate[] = knowledgeRows.map((r) => ({
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      sourceTitle: r.sourceTitle,
      heading: r.heading,
      content: r.content,
      embedding: r.embedding,
    }))
    candidates = [...documentCandidates, ...knowledgeCandidates]
  }

  if (candidates.length === 0) {
    return { answer: NO_MATERIAL_MSG, sources: [], usedAi: false }
  }

  const top = await rank(question, candidates)
  if (top.length === 0) {
    return { answer: NOT_FOUND_MSG, sources: [], usedAi: false }
  }

  const context = buildContext(top)
  // Only fetch the clock when we actually have an AI provider to reason with;
  // the verbatim-passage fallback below doesn't use it.
  const now =
    geminiClient || groqClient ? await getUserNow(userId) : null
  const { answer, usedAi } = await runWithAiFallback(
    "Knowledge Q&A",
    {
      gemini: geminiClient && now ? () => geminiAnswer(question, context, now) : undefined,
      groq: groqClient && now ? () => groqAnswer(question, context, now) : undefined,
    },
    // No AI available: hand back the best-matching passage verbatim so the
    // feature still works (just without a synthesised answer).
    () => ({ answer: top[0]!.content, usedAi: false }),
  )

  return { answer, sources: top.map(toSource), usedAi }
}
