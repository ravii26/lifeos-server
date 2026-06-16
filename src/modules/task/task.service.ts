import { NotFoundError } from "../../shared/utils/errors.util.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { findAreaById } from "../area/area.repository.js"
import { findGoalById } from "../goal/goal.repository.js"
import { findProjectById } from "../project/project.repository.js"
import {
  createTask,
  findTasksByUser,
  findTaskById,
  updateTask,
  deleteTask,
} from "./task.repository.js"
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
  if (links.projectId) {
    const project = await findProjectById(links.projectId, userId)
    if (!project) throw new NotFoundError("Project not found")
  }
}

export const createTaskService = async (
  userId: string,
  input: CreateTaskDto,
): Promise<TaskDto> => {
  await assertLinksOwned(userId, input)

  return createTask({
    userId,
    areaId: input.areaId ?? null,
    goalId: input.goalId ?? null,
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
  })
}

export const listTasksService = (
  userId: string,
  filters: ListTasksDto,
): Promise<TaskDto[]> => {
  return findTasksByUser(userId, {
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
    ...(filters.areaId && { areaId: filters.areaId }),
    ...(filters.goalId && { goalId: filters.goalId }),
    ...(filters.projectId && { projectId: filters.projectId }),
  })
}

export const getTaskService = (id: string, userId: string): Promise<TaskDto> => {
  return getOwnedTask(id, userId)
}

export const updateTaskService = async (
  id: string,
  userId: string,
  input: UpdateTaskDto,
): Promise<TaskDto> => {
  await getOwnedTask(id, userId)
  await assertLinksOwned(userId, input)
  return updateTask(id, input)
}

export const completeTaskService = async (
  id: string,
  userId: string,
): Promise<TaskDto> => {
  await getOwnedTask(id, userId)
  const task = await updateTask(id, {
    status: "COMPLETED",
    completedAt: new Date(),
  })
  logBehavior(userId, "TASK_COMPLETED", { taskId: id })
  return task
}

export const deleteTaskService = async (id: string, userId: string): Promise<void> => {
  await getOwnedTask(id, userId)
  await deleteTask(id)
}
