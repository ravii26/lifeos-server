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
