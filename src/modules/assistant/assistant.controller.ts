import type { Request, Response } from "express"
import { assistantAsk } from "./assistant.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { z } from "zod"
import prisma from "../../lib/prisma.js"
import { assistantChat } from "./assistant.chat.js"
import { listMemories, deleteMemory } from "./assistant.memory.js"

export const assistantAskController = async (req: Request, res: Response) => {
  const { message, history } = req.body as {
    message?: string
    history?: { role: "user" | "assistant"; text: string }[]
  }
  if (typeof message !== "string") {
    throw new ValidationError("message is required")
  }
  const result = await assistantAsk(req.user!.id, message, history)
  sendSuccess(res, "Assistant reply generated", result)
}

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(20)
    .optional(),
})

// POST /assistant/chat — reply + executed actions (tasks, habits, reminders).
export const assistantChatController = async (req: Request, res: Response) => {
  const parsed = chatSchema.safeParse(req.body)
  if (!parsed.success) throw new ValidationError("message is required")
  const result = await assistantChat(req.user!.id, parsed.data.message, parsed.data.history)
  sendSuccess(res, "Assistant reply", result)
}

// GET /assistant/reminders — upcoming reminders, so the phone can
// (re)schedule them after a reinstall or on another device.
export const listRemindersController = async (req: Request, res: Response) => {
  const rows = await prisma.reminder.findMany({
    where: { userId: req.user!.id, status: "PENDING", remindAt: { gte: new Date(Date.now() - 60_000) } },
    orderBy: { remindAt: "asc" },
    take: 50,
  })
  sendSuccess(res, "Reminders", rows)
}

// PATCH /assistant/reminders/:id — mark DONE or CANCELLED.
export const updateReminderController = async (req: Request, res: Response) => {
  const status = (req.body as { status?: string }).status
  if (status !== "DONE" && status !== "CANCELLED") throw new ValidationError("status must be DONE or CANCELLED")
  const result = await prisma.reminder.updateMany({
    where: { id: String(req.params.id), userId: req.user!.id },
    data: { status },
  })
  if (result.count === 0) throw new NotFoundError("Reminder not found")
  sendSuccess(res, "Updated")
}

// GET /assistant/memories — everything the assistant remembers about you.
export const listMemoriesController = async (req: Request, res: Response) => {
  sendSuccess(res, "Memories", await listMemories(req.user!.id))
}

// DELETE /assistant/memories/:id — forget one thing.
export const deleteMemoryController = async (req: Request, res: Response) => {
  const result = await deleteMemory(req.user!.id, String(req.params.id))
  if (result.count === 0) throw new NotFoundError("Memory not found")
  sendSuccess(res, "Forgotten")
}
