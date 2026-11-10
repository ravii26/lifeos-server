import prisma from "../../lib/prisma.js"
import { activeHoldIds } from "./pile.rules.js"

// Everything the person said should wait until a later date.
export const activeHolds = async (userId: string, todayKey: string): Promise<Set<string>> => {
  const events = await prisma.activityEvent.findMany({
    where: { userId, undoneAt: null, itemId: { not: null }, reason: { startsWith: "until:" } },
    orderBy: { at: "desc" },
    select: { itemId: true, reason: true },
    take: 500,
  })
  return activeHoldIds(events, todayKey)
}
