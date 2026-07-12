// Pure, dependency-free document chunking. Splitting text into retrievable
// slices is deterministic logic (no I/O), kept separate from the service so it
// can be unit-tested like habit.stats.ts.

export interface Chunk {
  heading?: string
  content: string
}

export interface ChunkOptions {
  // Soft upper bound on chunk size. A chunk may slightly exceed this only when a
  // single paragraph is itself larger (then it's hard-split by sentence).
  maxChars?: number
  // Characters of trailing context carried into the next chunk, so an answer
  // that straddles a boundary is still retrievable from one chunk.
  overlap?: number
  // Safety cap so a pathological input can't create unbounded rows.
  maxChunks?: number
}

const DEFAULTS: Required<ChunkOptions> = {
  maxChars: 1200,
  overlap: 150,
  maxChunks: 500,
}

// A short standalone line that introduces the block(s) below it. Covers markdown
// headings (`## Foo`), numbered sections ("3. Protein"), and shout-y titles
// ("PART 4 — CARBOHYDRATES"). Deliberately conservative: long prose never
// qualifies, so body text is not mistaken for a heading.
const isHeading = (block: string): boolean => {
  if (block.includes("\n")) return false
  const t = block.trim()
  if (t.length === 0 || t.length > 80) return false
  if (/^#{1,6}\s/.test(t)) return true
  if (/^part\s+\d+/i.test(t) || /^chapter\s+\d+/i.test(t) || /^section\s+\d+/i.test(t)) return true
  if (/^\d+[.)]\s+\S/.test(t) && t.length <= 60) return true
  // ALL-CAPS-ish short line (allow digits/punctuation), e.g. "COACH'S NOTES".
  const letters = t.replace(/[^a-zA-Z]/g, "")
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true
  return false
}

const cleanHeading = (block: string): string => block.trim().replace(/^#{1,6}\s+/, "")

// Break one oversized block into <=maxChars pieces at sentence boundaries,
// falling back to a hard character cut if a single "sentence" is still too long.
const splitLongBlock = (block: string, maxChars: number): string[] => {
  const sentences = block.split(/(?<=[.!?])\s+/)
  const pieces: string[] = []
  let buf = ""
  for (const s of sentences) {
    if (s.length > maxChars) {
      if (buf) {
        pieces.push(buf)
        buf = ""
      }
      for (let i = 0; i < s.length; i += maxChars) pieces.push(s.slice(i, i + maxChars))
      continue
    }
    if (buf.length + s.length + 1 > maxChars) {
      pieces.push(buf)
      buf = s
    } else {
      buf = buf ? `${buf} ${s}` : s
    }
  }
  if (buf) pieces.push(buf)
  return pieces
}

const tail = (text: string, n: number): string => (n <= 0 ? "" : text.slice(-n))

export const chunkDocument = (text: string, options: ChunkOptions = {}): Chunk[] => {
  const { maxChars, overlap, maxChunks } = { ...DEFAULTS, ...options }
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  if (!normalized) return []

  // Blank-line-separated blocks preserve the author's paragraph structure.
  const blocks = normalized.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)

  const chunks: Chunk[] = []
  let currentHeading: string | undefined
  let buf = ""

  const flush = (): void => {
    if (!buf.trim()) return
    if (chunks.length >= maxChunks) return
    chunks.push({ heading: currentHeading, content: buf.trim() })
    buf = ""
  }

  for (const block of blocks) {
    if (chunks.length >= maxChunks) break

    if (isHeading(block)) {
      // A heading starts a new section: flush what we have, then carry the
      // heading text into the next chunk's content so it's both a label and
      // part of the embedded/answerable text.
      flush()
      currentHeading = cleanHeading(block)
      buf = currentHeading
      continue
    }

    const pieces = block.length > maxChars ? splitLongBlock(block, maxChars) : [block]
    for (const piece of pieces) {
      if (buf && buf.length + piece.length + 2 > maxChars) {
        const carry = tail(buf, overlap)
        flush()
        buf = carry ? `${carry}\n${piece}` : piece
      } else {
        buf = buf ? `${buf}\n${piece}` : piece
      }
    }
  }
  flush()

  return chunks
}
