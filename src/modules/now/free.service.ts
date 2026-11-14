/* "I've got time": loads what the Now card loads, and asks the free-time rules
   (free.rules.ts). Reads only: nothing is written and no AI is called. */
import { freeTime, type Energy, type FreeResult, type Place } from "./free.rules.js"
import { getClock, getMode, loadCandidates } from "./now.service.js"

export const freeTimeService = async (
  userId: string,
  opts: { minutes: number; energy: Energy; place: Place; at?: string },
): Promise<FreeResult> => {
  const c = await getClock(userId, opts.at)
  const [{ mode }, candidates] = await Promise.all([getMode(userId, c.now), loadCandidates(userId, c)])
  return freeTime({
    minutes: Math.min(opts.minutes, 600),
    energy: opts.energy,
    place: opts.place,
    todayKey: c.todayKey,
    weekday: c.weekday,
    mode,
    candidates,
  })
}
