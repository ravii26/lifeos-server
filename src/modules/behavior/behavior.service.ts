import type { Prisma } from "@prisma/client"
import logger from "../../lib/logger.js"
import { createBehaviorLog, findBehaviorLogsByUser } from "./behavior.repository.js"
import type { behaviorEvent, LogBehaviorDto, ListBehaviorDto } from "./behavior.schema.js"
import type { z } from "zod"
import type { BehaviorLogDto } from "./behavior.dto.js"

type BehaviorEvent = z.infer<typeof behaviorEvent>

// Fire-and-forget. Internal services call this to record an event without
// awaiting it — logging must NEVER break or slow the real operation, so any
// failure is swallowed and logged, never thrown.
export const logBehavior = (
  userId: string,
  eventType: BehaviorEvent,
  metadata?: Record<string, unknown>,
): void => {
  void createBehaviorLog({
    userId,
    eventType,
    metadata: metadata as Prisma.InputJsonValue | undefined,
  }).catch((err) => logger.warn(`Failed to record behavior ${eventType}: ${err}`))
}

// Client-reported events go through here (awaited, returns the row).
export const recordBehaviorService = (
  userId: string,
  input: LogBehaviorDto,
): Promise<BehaviorLogDto> => {
  return createBehaviorLog({
    userId,
    eventType: input.eventType,
    metadata: input.metadata as Prisma.InputJsonValue | undefined,
  })
}

export const listBehaviorService = (
  userId: string,
  filters: ListBehaviorDto,
): Promise<BehaviorLogDto[]> => {
  const timeRange: { gte?: Date; lte?: Date } = {}
  if (filters.from) timeRange.gte = filters.from
  if (filters.to) timeRange.lte = filters.to

  return findBehaviorLogsByUser(userId, {
    ...(filters.eventType && { eventType: filters.eventType }),
    ...(Object.keys(timeRange).length && { occurredAt: timeRange }),
  })
}
