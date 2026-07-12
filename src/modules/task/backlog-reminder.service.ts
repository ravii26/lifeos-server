import { createTask, findTasksByUser, updateTask } from "./task.repository.js"
import { countResourcesByUser } from "../resource/resource.repository.js"
import { createLinkService } from "../link/link.service.js"
import logger from "../../lib/logger.js"

export const BACKLOG_THRESHOLD = 5

const backlogTitle = (count: number) => `${count} things saved to watch/read — pick one`

// Best-effort nudge: called right after a Capture becomes a Resource, since
// that's the only moment the "to watch" backlog can grow. No cron needed.
export const maybeCreateBacklogReminder = async (
  userId: string,
  latestResourceId: string,
): Promise<void> => {
  try {
    const count = await countResourcesByUser(userId, { status: "NOT_STARTED" })
    if (count < BACKLOG_THRESHOLD) return

    const [openReminder] = await findTasksByUser(userId, {
      source: "BACKLOG_REMINDER",
      status: { not: "COMPLETED" },
    })

    let task = openReminder
    if (task) {
      await updateTask(task.id, userId, { title: backlogTitle(count) })
    } else {
      task = await createTask({
        userId,
        title: backlogTitle(count),
        priority: "MEDIUM",
        status: "TODO",
        taskType: "BOOLEAN",
        source: "BACKLOG_REMINDER",
        sourceId: latestResourceId,
      })
    }

    await createLinkService(userId, {
      fromType: "TASK",
      fromId: task.id,
      toType: "RESOURCE",
      toId: latestResourceId,
      role: "REFERENCES",
    })
  } catch (err) {
    logger.warn(
      `Failed to create/update backlog reminder task for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
