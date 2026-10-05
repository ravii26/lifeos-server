/* =====================================================================
   Behaviour patterns the assistant may gently point out. Computed from
   real data, never guessed by the model: the model only decides whether
   mentioning one helps right now.
   ===================================================================== */
import prisma from "../../lib/prisma.js"

const DAY = 86_400_000

export interface PatternFacts {
  savesLast14: number
  savesActedOn: number // saves turned into a task that was then completed
  savesStillUndecided: number
  nightsAnswered: { firstWeek: number; secondWeek: number } // DONE/MINIMUM per week, oldest week first
  missedNightsInARow: number
  tasksCompletedLast14: number
  tasksAddedLast14: number
}

export interface Pattern {
  id: "CONSUMING_NOT_DOING" | "STRONG_START_FADING" | "PILING_UP" | "SLIPPING"
  evidence: string
}

// Pure: turns the counts into patterns worth mentioning (or none).
export const detectPatterns = (f: PatternFacts): Pattern[] => {
  const out: Pattern[] = []
  if (f.savesLast14 >= 5 && f.savesActedOn <= Math.floor(f.savesLast14 / 5)) {
    out.push({
      id: "CONSUMING_NOT_DOING",
      evidence: `Saved ${f.savesLast14} things in 2 weeks and acted on ${f.savesActedOn}.`,
    })
  }
  if (f.nightsAnswered.firstWeek >= 4 && f.nightsAnswered.secondWeek <= f.nightsAnswered.firstWeek / 2) {
    out.push({
      id: "STRONG_START_FADING",
      evidence: `Followed through ${f.nightsAnswered.firstWeek} nights last week, ${f.nightsAnswered.secondWeek} this week.`,
    })
  }
  if (f.tasksAddedLast14 >= 8 && f.tasksCompletedLast14 <= f.tasksAddedLast14 / 4) {
    out.push({
      id: "PILING_UP",
      evidence: `Added ${f.tasksAddedLast14} tasks in 2 weeks and finished ${f.tasksCompletedLast14}.`,
    })
  }
  if (f.missedNightsInARow >= 2) {
    out.push({ id: "SLIPPING", evidence: `Missed the last ${f.missedNightsInARow} nights.` })
  }
  return out
}

export const loadPatternFacts = async (userId: string, now = new Date()): Promise<PatternFacts> => {
  const since14 = new Date(now.getTime() - 14 * DAY)
  const since7 = new Date(now.getTime() - 7 * DAY)
  const [saves, nights, completed, added] = await Promise.all([
    prisma.capture.findMany({
      where: { userId, createdAt: { gte: since14 }, suggestedOutputs: { path: ["kind"], equals: "SAVE" } },
      select: { id: true, status: true },
    }),
    prisma.nightlyCommitment.findMany({
      where: { userId, date: { gte: since14 } },
      orderBy: { date: "desc" },
      select: { date: true, status: true },
    }),
    prisma.task.count({ where: { userId, status: "COMPLETED", completedAt: { gte: since14 } } }),
    prisma.task.count({ where: { userId, createdAt: { gte: since14 } } }),
  ])

  const saveIds = saves.map((s) => s.id)
  const savesActedOn = saveIds.length
    ? await prisma.task.count({ where: { userId, sourceId: { in: saveIds }, status: "COMPLETED" } })
    : 0

  const followed = (n: { status: string }) => n.status === "DONE" || n.status === "MINIMUM"
  let missed = 0
  for (const n of nights) {
    if (n.date.getTime() >= now.getTime() - DAY) continue // tonight isn't over yet
    if (n.status === "SKIPPED" || n.status === "PENDING") missed++
    else break
  }

  return {
    savesLast14: saves.length,
    savesActedOn,
    savesStillUndecided: saves.filter((s) => s.status === "PENDING").length,
    nightsAnswered: {
      firstWeek: nights.filter((n) => n.date < since7 && followed(n)).length,
      secondWeek: nights.filter((n) => n.date >= since7 && followed(n)).length,
    },
    missedNightsInARow: missed,
    tasksCompletedLast14: completed,
    tasksAddedLast14: added,
  }
}
