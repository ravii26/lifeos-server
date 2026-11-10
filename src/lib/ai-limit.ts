/* =====================================================================
   Daily AI cap per person, so one heavy user (or a stuck loop) cannot
   spend the whole AI budget. Counted from the AiCall log that every
   provider request already writes (lib/ai-usage.ts), from midnight in the
   person's own time zone. Past the cap, runWithAiFallback skips the
   providers and answers with the plain code path; chat tells the phone.
   ===================================================================== */
import { env } from "../config/env.config.js"
import { isAdminEmail } from "../modules/admin/admin.rules.js"
import { localDayStartMs, todayKeyInTz } from "../shared/utils/time.util.js"
import { currentAiUser } from "./ai-usage.js"
import prisma from "./prisma.js"
import logger from "./logger.js"

// Pure rule: a cap of 0 means no cap.
export const overLimit = (used: number, limit: number): boolean => limit > 0 && used >= limit

// When the person's day began, as a Date.
export const dayStartFor = (timeZone: string, now: Date = new Date()): Date =>
  new Date(localDayStartMs(todayKeyInTz(timeZone, now), timeZone))

// True when the person this request is for has used today's AI.
// Never throws: if the check itself fails, the AI is allowed.
export const overDailyAiLimit = async (now: Date = new Date()): Promise<boolean> => {
  const userId = currentAiUser()
  const limit = env.AI_DAILY_CALLS_PER_USER
  if (!userId || limit <= 0) return false
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true, email: true } })
    if (!user || isAdminEmail(user.email, env.ADMIN_EMAILS)) return false
    const used = await prisma.aiCall.count({ where: { userId, ok: true, createdAt: { gte: dayStartFor(user.timezone || "Asia/Kolkata", now) } } })
    return overLimit(used, limit)
  } catch (err) {
    logger.warn("Could not check the daily AI cap", err)
    return false
  }
}
