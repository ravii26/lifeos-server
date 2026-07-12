import { geminiClient } from "./gemini.js"

// We embed chunks + questions with Gemini and store the vectors as a plain
// double[] on DocumentChunk/KnowledgeChunk, ranking with cosine similarity
// in-process (no pgvector yet — fine at personal scale). The same function
// embeds both sides, so the exact dimensionality doesn't matter as long as
// it's consistent. Embeddings are Gemini-only here; Groq has no embedding
// API, so ingestion/ask degrade to a keyword heuristic when GEMINI_API_KEY is
// unset (see knowledge.ask.ts).
const EMBED_MODEL = "gemini-embedding-001"

export const embeddingsAvailable = (): boolean => geminiClient !== null

// Embed a single text (used for the question at ask time).
export const embedText = async (text: string): Promise<number[]> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")
  const model = geminiClient.getGenerativeModel({ model: EMBED_MODEL })
  const res = await model.embedContent(text)
  return res.embedding.values
}

// Embed many texts with bounded concurrency so a large document doesn't fire
// hundreds of simultaneous requests. Order is preserved (result[i] ↔ texts[i]).
export const embedTexts = async (
  texts: string[],
  concurrency = 5,
): Promise<number[][]> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")
  const out: number[][] = new Array(texts.length)
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < texts.length) {
      const i = cursor++
      out[i] = await embedText(texts[i]!)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, texts.length) }, () => worker()),
  )
  return out
}

// Cosine similarity of two equal-length vectors. Returns 0 for a zero vector
// rather than NaN so ranking stays well-defined.
export const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
