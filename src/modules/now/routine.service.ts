/* =====================================================================
   The routine on Now (Phase D slice D4, ADR 0041): when the current part
   of the day has a routine of the same name ("Gym" at gym time, "Morning",
   "Evening"), Now shows it as a checklist. Ticked steps are the note's
   `done`. Null when there is none or it has no steps.
   ===================================================================== */
import prisma from "../../lib/prisma.js"

export interface NowRoutine {
  id: string
  title: string
  steps: { text: string; done: boolean }[]
  remaining: number
}

export const routineNowService = async (userId: string, block: string): Promise<NowRoutine | null> => {
  const want = block.toLowerCase()
  const notes = await prisma.allyNote.findMany({
    where: { userId, template: "ROUTINE", NOT: { collection: "Diet" } },
    select: { id: true, collection: true, title: true, items: true, done: true },
  })
  const note = notes.find((n) => n.collection.trim().toLowerCase() === want)
  if (!note || !note.items.length) return null
  const steps = note.items.map((text) => ({ text, done: note.done.includes(text) }))
  return { id: note.id, title: note.title, steps, remaining: steps.filter((s) => !s.done).length }
}
