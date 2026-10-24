/* =====================================================================
   Watch later on Now (Phase D slice D6, ADR 0043): when there is room, one
   queued save is offered as a quiet extra line under the main pick. Never
   at work, never at night, never in a mode that asks for the smallest thing.
   ===================================================================== */
import { listQueueService } from "../guide/guide.saves.service.js"
import { pickWatchLater, suggestionLine } from "../guide/saves.later.rules.js"

export interface NowWatchLater {
  id: string
  title: string
  minutes: number | null
  url: string | null
  platform: string | null
  line: string
}

export const watchLaterNowService = async (userId: string, now: { availableMinutes: number; block: string; mode: string }): Promise<NowWatchLater | null> => {
  const queue = await listQueueService(userId)
  if (!queue.length) return null
  const pick = pickWatchLater(queue, now.availableMinutes, now.block, now.mode)
  return pick ? { id: pick.id, title: pick.title, minutes: pick.minutes, url: pick.url, platform: pick.platform, line: suggestionLine(pick) } : null
}
