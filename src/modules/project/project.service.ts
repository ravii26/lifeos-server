import { recordActivity, type ActivityOptions } from "../activity/activity.service.js"
import { NotFoundError } from "../../shared/utils/errors.util.js"
import { findAreaById } from "../area/area.repository.js"
import { findGoalById } from "../goal/goal.repository.js"
import {
  createProject,
  findProjectsByUser,
  countProjectsByUser,
  findProjectById,
  updateProject,
  deleteProject,
} from "./project.repository.js"
import { getPagination, paginatedResponse } from "../../shared/utils/pagination.util.js"
import type { CreateProjectDto, UpdateProjectDto, ListProjectsDto } from "./project.schema.js"
import type { ProjectDto } from "./project.dto.js"

const getOwnedProject = async (id: string, userId: string) => {
  const project = await findProjectById(id, userId)
  if (!project) throw new NotFoundError("Project not found")
  return project
}

const assertAreaOwned = async (areaId: string, userId: string) => {
  const area = await findAreaById(areaId, userId)
  if (!area) throw new NotFoundError("Area not found")
}

const assertGoalOwned = async (goalId: string, userId: string) => {
  const goal = await findGoalById(goalId, userId)
  if (!goal) throw new NotFoundError("Goal not found")
}

export const createProjectService = async (
  userId: string,
  input: CreateProjectDto,
  opts: ActivityOptions = {},
): Promise<ProjectDto & { activityId?: string }> => {
  await assertAreaOwned(input.areaId, userId)
  if (input.goalId) await assertGoalOwned(input.goalId, userId)

  const project = await createProject({
    userId,
    areaId: input.areaId,
    goalId: input.goalId ?? null,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "ACTIVE",
    deadline: input.deadline ?? null,
    kind: input.kind ?? "WORK",
    why: input.why ?? null,
    priority: input.priority ?? "MEDIUM",
    weeklyTargetMinutes: input.weeklyTargetMinutes ?? null,
    ...(input.metric && { metric: { create: input.metric } }),
    ...(input.milestones?.length && {
      milestones: { create: input.milestones.map((m, order) => ({ title: m.title, order, target: m.target ?? null })) },
    }),
  })
  const event = await recordActivity(userId, {
    type: "CREATED",
    itemType: "PROJECT",
    itemId: project.id,
    title: project.title,
    source: opts.source,
    undo: { kind: "ARCHIVE_PROJECT", projectId: project.id },
  })
  return { ...project, activityId: event?.id }
}

export const listProjectsService = async (
  userId: string,
  filters: ListProjectsDto,
): Promise<ProjectDto[] | ReturnType<typeof paginatedResponse>> => {
  const where = {
    ...(filters.areaId && { areaId: filters.areaId }),
    ...(filters.goalId && { goalId: filters.goalId }),
    ...(filters.status && { status: filters.status }),
  }

  if (filters.page || filters.limit) {
    const params = getPagination(filters.page, filters.limit)
    const [items, total] = await Promise.all([
      findProjectsByUser(userId, where, params.skip, params.limit),
      countProjectsByUser(userId, where),
    ])
    return paginatedResponse(items, total, params)
  }

  return findProjectsByUser(userId, where)
}

export const getProjectService = (id: string, userId: string): Promise<ProjectDto> => {
  return getOwnedProject(id, userId)
}

export const updateProjectService = async (
  id: string,
  userId: string,
  input: UpdateProjectDto,
): Promise<ProjectDto> => {
  await getOwnedProject(id, userId)
  if (input.areaId) await assertAreaOwned(input.areaId, userId)
  if (input.goalId) await assertGoalOwned(input.goalId, userId)
  await updateProject(id, userId, input)
  return getOwnedProject(id, userId)
}

export const deleteProjectService = async (id: string, userId: string): Promise<void> => {
  await getOwnedProject(id, userId)
  await deleteProject(id, userId)
}
