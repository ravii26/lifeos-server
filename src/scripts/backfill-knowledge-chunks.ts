/**
 * One-time backfill: embed existing Notes and Resources-with-notes into
 * KnowledgeChunk so they become answerable by the "ask" endpoint immediately,
 * not just ones created/edited after this feature shipped.
 *
 * Safe to re-run: embedSource replaces a source's chunks each time, so running
 * this twice just re-embeds the same content.
 *
 *   npm run backfill:knowledge          # apply
 *   npm run backfill:knowledge -- --dry # report only, write nothing
 */
import prisma from "../lib/prisma.js"
import { embedSource } from "../modules/knowledge/knowledge.embed.service.js"

const DRY_RUN = process.argv.includes("--dry")

async function main() {
  const notes = await prisma.note.findMany({
    select: { id: true, userId: true, title: true, content: true },
  })
  const resources = await prisma.resource.findMany({
    where: { notes: { not: null } },
    select: { id: true, userId: true, title: true, notes: true },
  })

  console.log(
    `Found ${notes.length} note(s) and ${resources.length} resource(s) with notes${DRY_RUN ? " (dry run)" : ""}.`,
  )

  let embedded = 0
  let skippedEmpty = 0

  for (const note of notes) {
    if (!note.content.trim()) {
      skippedEmpty++
      continue
    }
    if (!DRY_RUN) await embedSource(note.userId, "NOTE", note.id, note.title, note.content)
    embedded++
  }

  for (const resource of resources) {
    const text = resource.notes ?? ""
    if (!text.trim()) {
      skippedEmpty++
      continue
    }
    if (!DRY_RUN) await embedSource(resource.userId, "RESOURCE", resource.id, resource.title, text)
    embedded++
  }

  console.log(
    `${DRY_RUN ? "Would embed" : "Embedded"}: ${embedded}  |  Skipped (empty content): ${skippedEmpty}`,
  )
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
