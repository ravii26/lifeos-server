/* =====================================================================
   "What did I save about caching?": pure search scoring over what the
   person put in (notes, to-dos, saves, projects, memories). Word-based with
   light stemming; no AI and no embeddings, which is plenty at personal
   scale and never invents a result. Also the memory-privacy rule.
   ===================================================================== */

const STOP = new Set(
  ("a an the and or but i me my mine to of in on at for with is am are was were be been it this that you your so just do did " +
    "what which who how when where why about any anything save saved find show tell give have has had can will not no yes " +
    "some there their them they these those from into over under again also very more most than then too has").split(" "),
)

// "caching", "cached", "caches", "cache" all become "cach".
export const stem = (w: string): string => w.toLowerCase().replace(/(ing|ed|es|s)$/, "").replace(/e$/, "")

export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length > 1)

export type SearchKind = "NOTE" | "TASK" | "SAVE" | "PROJECT" | "MEMORY"

export interface Searchable {
  kind: SearchKind
  id: string
  title: string
  body: string // everything else worth matching (items, text, summary…)
  at?: Date
}

export interface SearchHit {
  kind: SearchKind
  id: string
  title: string
  snippet: string
  score: number
}

const snippetOf = (body: string, queryTokens: Set<string>): string => {
  const parts = body.split(/\n|(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean)
  const best = parts.find((p) => tokenize(p).some((t) => queryTokens.has(t))) ?? parts[0] ?? ""
  return best.length > 140 ? `${best.slice(0, 137)}…` : best
}

// Title matches count more than body matches; matching every query word beats
// matching one; ties go to the newer item.
export const searchItems = (items: Searchable[], query: string, limit = 8): SearchHit[] => {
  const q = [...new Set(tokenize(query))]
  if (!q.length) return []
  const qs = new Set(q)
  return items
    .map((it) => {
      const title = new Set(tokenize(it.title))
      const body = new Set(tokenize(it.body))
      const inTitle = q.filter((t) => title.has(t)).length
      const inBody = q.filter((t) => body.has(t) && !title.has(t)).length
      const hit = inTitle + inBody
      if (!hit) return null
      const coverage = hit / q.length
      const recency = it.at ? Math.max(0, 1 - (Date.now() - it.at.getTime()) / (365 * 86_400_000)) : 0
      return { it, score: inTitle * 3 + inBody + coverage * 2 + recency * 0.5 }
    })
    .filter((x): x is { it: Searchable; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ it, score }) => ({ kind: it.kind, id: it.id, title: it.title, snippet: snippetOf(`${it.title}. ${it.body}`, qs), score }))
}

const KIND_LABEL: Record<SearchKind, string> = { NOTE: "note", TASK: "to-do", SAVE: "save", PROJECT: "goal", MEMORY: "memory" }

export const searchMessage = (query: string, hits: SearchHit[]): string => {
  if (!hits.length) return `I couldn't find anything about "${query}" in your notes, saves or to-dos.`
  const lines = hits.slice(0, 6).map((h) => `- ${KIND_LABEL[h.kind]}: ${h.title}${h.snippet && h.snippet !== h.title ? ` (${h.snippet.replace(/^[^.]*\.\s*/, "") || h.snippet})` : ""}`)
  return `${hits.length} thing${hits.length === 1 ? "" : "s"} about "${query}":\n${lines.join("\n")}`
}

// ---- memory privacy ---------------------------------------------------------

// Health and mental-health memories stay out of every prompt unless the
// message itself touches them: "never brought up unless the person does".
export const visibleMemories = <T extends { content: string; sensitive: boolean }>(memories: T[], message: string): T[] => {
  const said = new Set(tokenize(message))
  return memories.filter((m) => !m.sensitive || tokenize(m.content).some((t) => said.has(t)))
}

// ---- which notes go into the prompt ----------------------------------------------

export interface NoteLike {
  id: string
  collection: string
  title: string
  items: string[]
  text: string | null
  updatedAt: Date
}

// A personal-scale collection fits in the prompt; when it does not, the notes
// that share words with the question go first, then the newest.
export const pickNotesForPrompt = <T extends NoteLike>(notes: T[], message: string, limit = 12): T[] => {
  const q = new Set(tokenize(message))
  return [...notes]
    .map((n) => {
      const hay = new Set(tokenize(`${n.collection} ${n.title} ${n.items.join(" ")} ${n.text ?? ""}`))
      const overlap = [...q].filter((t) => hay.has(t)).length
      return { n, score: overlap * 10 + n.updatedAt.getTime() / 1e13 }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.n)
}
