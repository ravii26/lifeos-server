import { NotFoundError } from "../../shared/utils/errors.util.js"
import {
  createArea,
  findAreasByUser,
  findAreaById,
  updateArea,
  deleteArea,
  getMaxOrder,
  findTasksForScoring,
  findHabitsWithLogsForScoring,
  findResourcesForScoring,
  createScoreSnapshot,
  findScoreSnapshots,
  findAllAreaSnapshots,
} from "./area.repository.js"
import { scoreArea } from "./area.scoring.js"
import type { CreateAreaDto, UpdateAreaDto } from "./area.schema.js"
import type { AreaDto, AreaWithScoreDto } from "./area.dto.js"

// Loads an area and confirms it belongs to the user. Throws if not found
// or not owned — used by every by-id operation so users can never touch
// another user's data by guessing IDs.
const getOwnedArea = async (id: string, userId: string) => {
  const area = await findAreaById(id, userId)
  if (!area) throw new NotFoundError("Area not found")
  return area
}

export const createAreaService = async (
  userId: string,
  input: CreateAreaDto,
): Promise<AreaDto> => {
  const order = input.order ?? (await getMaxOrder(userId)) + 1

  return createArea({
    userId,
    name: input.name,
    type: input.type ?? "PRIMARY",
    color: input.color,
    icon: input.icon,
    order,
    isDefault: input.isDefault ?? false,
    isActive: input.isActive ?? true,
  })
}

// Returns every area with its live computed score (A2). Pulls all the
// scoring inputs in three flat queries, then blends in memory.
export const listAreasService = async (userId: string): Promise<AreaWithScoreDto[]> => {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 28)

  const [areas, tasks, habits, resources] = await Promise.all([
    findAreasByUser(userId),
    findTasksForScoring(userId),
    findHabitsWithLogsForScoring(userId, since),
    findResourcesForScoring(userId),
  ])

  const input = { tasks, habits, resources }
  return areas.map((area) => ({ ...area, ...scoreArea(area.id, input) }))
}

export const getAreaService = (id: string, userId: string): Promise<AreaDto> => {
  return getOwnedArea(id, userId)
}

export const updateAreaService = async (
  id: string,
  userId: string,
  input: UpdateAreaDto,
): Promise<AreaDto> => {
  await getOwnedArea(id, userId)
  return updateArea(id, input)
}

export const deleteAreaService = async (id: string, userId: string): Promise<void> => {
  await getOwnedArea(id, userId)
  await deleteArea(id)
}

// A3 — snapshot the live score for a single area and persist it.
export const snapshotAreaScoreService = async (id: string, userId: string) => {
  await getOwnedArea(id, userId)

  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 28)

  const [tasks, habits, resources] = await Promise.all([
    findTasksForScoring(userId),
    findHabitsWithLogsForScoring(userId, since),
    findResourcesForScoring(userId),
  ])

  const scored = scoreArea(id, { tasks, habits, resources })
  return createScoreSnapshot({ userId, areaId: id, ...scored })
}

export const listAreaSnapshotsService = async (id: string, userId: string, limit = 30) => {
  await getOwnedArea(id, userId)
  return findScoreSnapshots(id, userId, limit)
}

// ---- area trends -------------------------------------------------------

export type TrendDirection = "UP" | "STABLE" | "DOWN"

export interface AreaTrend {
  areaId: string
  areaName: string
  currentScore: number | null
  previousScore: number | null
  delta: number | null
  direction: TrendDirection
  snapshotCount: number
  weakness: string
}

export interface AreaTrendsResult {
  trends: AreaTrend[]
  overallDirection: TrendDirection
  generatedAt: Date
}

const trendDirection = (delta: number | null): TrendDirection => {
  if (delta === null) return "STABLE"
  if (delta >= 3) return "UP"
  if (delta <= -3) return "DOWN"
  return "STABLE"
}

const computeWeakness = (areaId: string, scoringInput: Parameters<typeof scoreArea>[1]): string => {
  const areaTasks = scoringInput.tasks.filter((t) => t.areaId === areaId)
  const taskRate = areaTasks.length
    ? areaTasks.filter((t) => t.status === "COMPLETED").length / areaTasks.length
    : 0.5

  const areaHabits = scoringInput.habits.filter((h) => h.areaId === areaId)
  const habitRate = areaHabits.length
    ? areaHabits.reduce((sum, h) => {
        const done = h.logs.filter((l) => l.completed).length
        return sum + (h.logs.length ? done / h.logs.length : 0.5)
      }, 0) / areaHabits.length
    : 0.5

  const areaResources = scoringInput.resources.filter((r) => r.topic?.areaId === areaId)
  const learnRate = areaResources.length
    ? areaResources.filter((r) => r.status === "COMPLETED").length / areaResources.length
    : 0.4

  const weakest = [
    { name: "task completion", rate: taskRate },
    { name: "habit consistency", rate: habitRate },
    { name: "learning progress", rate: learnRate },
  ].sort((a, b) => a.rate - b.rate)[0]

  return `${weakest.name} (${Math.round(weakest.rate * 100)}%) is the weakest driver`
}

export const getAreaTrendsService = async (userId: string): Promise<AreaTrendsResult> => {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 28)

  const [areas, snapshots, tasks, habits, resources] = await Promise.all([
    findAreasByUser(userId),
    findAllAreaSnapshots(userId, 7),
    findTasksForScoring(userId),
    findHabitsWithLogsForScoring(userId, since),
    findResourcesForScoring(userId),
  ])

  const scoringInput = { tasks, habits, resources }

  // Group snapshots by areaId (already ordered desc)
  const grouped = new Map<string, typeof snapshots>()
  for (const s of snapshots) {
    if (!grouped.has(s.areaId)) grouped.set(s.areaId, [])
    const arr = grouped.get(s.areaId)!
    if (arr.length < 7) arr.push(s)
  }

  const trends: AreaTrend[] = areas.map((area) => {
    const snaps = grouped.get(area.id) ?? []
    const current = snaps[0] ?? null
    const previous = snaps[1] ?? null
    const delta = current && previous ? current.score - previous.score : null
    const direction = trendDirection(delta)

    return {
      areaId: area.id,
      areaName: area.name,
      currentScore: current?.score ?? null,
      previousScore: previous?.score ?? null,
      delta,
      direction,
      snapshotCount: snaps.length,
      weakness: computeWeakness(area.id, scoringInput),
    }
  })

  const ups = trends.filter((t) => t.direction === "UP").length
  const downs = trends.filter((t) => t.direction === "DOWN").length
  const overallDirection: TrendDirection = ups > downs ? "UP" : downs > ups ? "DOWN" : "STABLE"

  return { trends, overallDirection, generatedAt: new Date() }
}
