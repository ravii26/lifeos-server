import { findDecisionContext } from "./decisions.repository.js"
import { getDecisions } from "./decisions.ai.js"
import type { DecisionResult } from "./decisions.ai.js"
import { listBlocksService } from "../calendar/calendar.service.js"
import { dayKeyInTz, localDayStartMs } from "../../shared/utils/time.util.js"
import logger from "../../lib/logger.js"

const DAY_MS = 24 * 60 * 60 * 1000

export const getDecisionsService = async (userId: string): Promise<DecisionResult> => {
  const context = await findDecisionContext(userId)

  // Today's schedule (expanded for recurrence/exceptions), in the user's
  // timezone, so the engine can reason about what they're time-blocked into
  // right now. Non-fatal: if the calendar read fails, the engine still runs.
  const tz = context.timezone
  const dayStartMs = localDayStartMs(dayKeyInTz(new Date(), tz), tz)
  const todayBlocks = await listBlocksService(userId, {
    from: new Date(dayStartMs),
    to: new Date(dayStartMs + DAY_MS),
  }).catch((err) => {
    logger.warn(`Decisions: calendar fetch failed, continuing without schedule: ${err}`)
    return []
  })

  return getDecisions(context, todayBlocks)
}
