import { NotFoundError } from "../../shared/utils/errors.util.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { findAreaById } from "../area/area.repository.js"
import { findGoalById } from "../goal/goal.repository.js"
import { findProjectById } from "../project/project.repository.js"
import {
  createTask,
  findTasksByUser,
  countTasksByUser,
  findTaskById,
  updateTask,
  deleteTask,
} from "./task.repository.js"
import { getPagination, paginatedResponse } from "../../shared/utils/pagination.util.js"
import { rollupTaskAdvances } from "../link/link.rollup.js"
import { deleteLinksForEntity } from "../link/link.repository.js"
import type { CreateTaskDto, UpdateTaskDto, ListTasksDto } from "./task.schema.js"
import type { TaskDto } from "./task.dto.js"

// Loads a task and confirms it belongs to the user.
const getOwnedTask = async (id: string, userId: string) => {
  const task = await findTaskById(id, userId)
  if (!task) throw new NotFoundError("Task not found")
  return task
}

// Confirms any linked parent (area/goal/project) belongs to the user
// before attaching a task to it.
const assertLinksOwned = async (
  userId: string,
  links: { areaId?: string | null; goalId?: string | null; projectId?: string | null },
) => {
  if (links.areaId) {
    const area = await findAreaById(links.areaId, userId)
    if (!area) throw new NotFoundError("Area not found")
  }
  if (links.goalId) {
    const goal = await findGoalById(links.goalId, userId)
    if (!goal) throw new NotFoundError("Goal not found")
  }
  let project: Awaited<ReturnType<typeof findProjectById>> = null
  if (links.projectId) {
    project = await findProjectById(links.projectId, userId)
    if (!project) throw new NotFoundError("Project not found")
  }
  return { project }
}

export const createTaskService = async (
  userId: string,
  input: CreateTaskDto,
): Promise<TaskDto> => {
  const { project } = await assertLinksOwned(userId, input)

  // Inherit the project's goal when a task is filed under a project but no goal
  // was given explicitly — so project work rolls up to the goal's confidence.
  const goalId = input.goalId ?? project?.goalId ?? null

  return createTask({
    userId,
    areaId: input.areaId ?? null,
    goalId,
    projectId: input.projectId ?? null,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "TODO",
    priority: input.priority ?? "MEDIUM",
    taskType: input.taskType ?? "BOOLEAN",
    targetCount: input.targetCount ?? null,
    targetMinutes: input.targetMinutes ?? null,
    dueDate: input.dueDate ?? null,
    isRecurring: input.isRecurring ?? false,
    recurrence: input.recurrence ?? null,
    source: input.source ?? "MANUAL",
    sourceId: input.sourceId ?? null,
  })
}

export const listTasksService = async (
  userId: string,
  filters: ListTasksDto,
): Promise<TaskDto[] | ReturnType<typeof paginatedResponse>> => {
  const where = {
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
    ...(filters.areaId && { areaId: filters.areaId }),
    ...(filters.goalId && { goalId: filters.goalId }),
    ...(filters.projectId && { projectId: filters.projectId }),
  }

  if (filters.page || filters.limit) {
    const params = getPagination(filters.page, filters.limit)
    const [items, total] = await Promise.all([
      findTasksByUser(userId, where, params.skip, params.limit),
      countTasksByUser(userId, where),
    ])
    return paginatedResponse(items, total, params)
  }

  return findTasksByUser(userId, where)
}

export const getTaskService = (id: string, userId: string): Promise<TaskDto> => {
  return getOwnedTask(id, userId)
}

export const updateTaskService = async (
  id: string,
  userId: string,
  input: UpdateTaskDto,
): Promise<TaskDto> => {
  const existing = await getOwnedTask(id, userId)
  const { project } = await assertLinksOwned(userId, input)

  // If the task is being filed under a project and still has no goal of its own,
  // inherit the project's goal. Never overwrite an explicit or existing goal.
  const data: UpdateTaskDto = { ...input }
  if (input.goalId === undefined && existing.goalId === null && project?.goalId) {
    data.goalId = project.goalId
  }

  await updateTask(id, userId, data)

  // Resource roll-up on completion-state transitions driven through update()
  // — e.g. the task row's "un-complete" toggle sends { status: "TODO" }. Only
  // fires on an actual crossing of the COMPLETED boundary, never on same-status
  // edits, so a resource's lessonsCompleted can't drift.
  if (input.status && input.status !== existing.status) {
    if (input.status === "COMPLETED") {
      await rollupTaskAdvances(userId, id, 1)
    } else if (existing.status === "COMPLETED") {
      await rollupTaskAdvances(userId, id, -1)
    }
  }

  // Pushing an existing due date further out is a deferral — record it so the
  // coach can notice procrastination patterns (e.g. an area whose tasks keep
  // slipping). Only counts when a real prior due date moved later.
  if (
    input.dueDate &&
    existing.dueDate &&
    input.dueDate.getTime() > existing.dueDate.getTime()
  ) {
    logBehavior(userId, "TASK_DEFERRED", { taskId: id })
  }

  return getOwnedTask(id, userId)
}

export const completeTaskService = async (
  id: string,
  userId: string,
): Promise<TaskDto> => {
  const existing = await getOwnedTask(id, userId)
  await updateTask(id, userId, {
    status: "COMPLETED",
    completedAt: new Date(),
  })
  logBehavior(userId, "TASK_COMPLETED", { taskId: id })
  // Advance any Learn resources this task is linked to — but only on the real
  // →COMPLETED crossing, so completing an already-done task can't double-count.
  if (existing.status !== "COMPLETED") {
    await rollupTaskAdvances(userId, id, 1)
  }
  return getOwnedTask(id, userId)
}

export const deleteTaskService = async (id: string, userId: string): Promise<void> => {
  const existing = await getOwnedTask(id, userId)
  // Undo any resource progress this task was contributing before it disappears,
  // then remove its links so no EntityLink row is left pointing at a ghost task.
  if (existing.status === "COMPLETED") {
    await rollupTaskAdvances(userId, id, -1)
  }
  await deleteLinksForEntity(userId, "TASK", id)
  await deleteTask(id, userId)
}
