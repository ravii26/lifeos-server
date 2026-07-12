/**
 * One-time backfill: upgrade Task provenance breadcrumbs into real EntityLinks.
 *
 * Before EntityLink, a task created from a Learn note only carried a one-way
 * `source=LEARN` + `sourceId` (the Note id) — not a queryable link and useless
 * for progress roll-up. This turns each such breadcrumb into a proper
 * TASK --ADVANCES--> NOTE link.
 *
 * Safe to re-run: skips links that already exist (unique constraint) and skips
 * any breadcrumb whose Note no longer exists or is owned by a different user.
 *
 *   npm run backfill:links          # apply
 *   npm run backfill:links -- --dry # report only, write nothing
 */
import prisma from "../lib/prisma.js"

const DRY_RUN = process.argv.includes("--dry")

async function main() {
  const learnTasks = await prisma.task.findMany({
    where: { source: "LEARN", sourceId: { not: null } },
    select: { id: true, userId: true, sourceId: true },
  })

  console.log(
    `Found ${learnTasks.length} LEARN-sourced task(s)${DRY_RUN ? " (dry run)" : ""}.`,
  )

  let created = 0
  let skippedMissingNote = 0
  let skippedDuplicate = 0

  for (const task of learnTasks) {
    const noteId = task.sourceId!

    // Only link if the referenced Note still exists AND belongs to the same
    // user — a stale or cross-user sourceId must never produce a link.
    const note = await prisma.note.findFirst({
      where: { id: noteId, userId: task.userId },
      select: { id: true },
    })
    if (!note) {
      skippedMissingNote++
      continue
    }

    const existing = await prisma.entityLink.findFirst({
      where: {
        userId: task.userId,
        fromType: "TASK",
        fromId: task.id,
        toType: "NOTE",
        toId: noteId,
        role: "ADVANCES",
      },
      select: { id: true },
    })
    if (existing) {
      skippedDuplicate++
      continue
    }

    if (!DRY_RUN) {
      await prisma.entityLink.create({
        data: {
          userId: task.userId,
          fromType: "TASK",
          fromId: task.id,
          toType: "NOTE",
          toId: noteId,
          role: "ADVANCES",
        },
      })
    }
    created++
  }

  console.log(
    `${DRY_RUN ? "Would create" : "Created"}: ${created}  |  ` +
      `Skipped (note missing/cross-user): ${skippedMissingNote}  |  ` +
      `Skipped (link already existed): ${skippedDuplicate}`,
  )
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
