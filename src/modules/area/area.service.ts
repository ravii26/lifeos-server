import { NotFoundError } from "../../shared/utils/errors.util.js"
import {
  createArea,
  findAreasByUser,
  findAreaById,
  updateArea,
  deleteArea,
  getMaxOrder,
} from "./area.repository.js"
import type { CreateAreaDto, UpdateAreaDto } from "./area.schema.js"
import type { AreaDto } from "./area.dto.js"

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

export const listAreasService = (userId: string): Promise<AreaDto[]> => {
  return findAreasByUser(userId)
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
