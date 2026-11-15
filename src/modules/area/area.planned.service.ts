// Planned mode changes ("after the job switch, Career goes to Maintain"):
// applied the first time the areas are read on or after their day. There is
// no background job; the server only works when the phone asks.

import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import { todayKeyInTz, utcDayKey } from "../../shared/utils/time.util.js"
import { modeOfTier, plannedDue } from "./area.overview.rules.js"

const LABEL = { PUSH: "Push", MAINTAIN: "Maintain", EXPLORE: "Explore", REST: "Rest" } as const

export const applyPlannedModes = async (userId: string, now: Date = new Date()): Promise<number> => {
  const planned = await prisma.area.findMany({
    where: { userId, nextTier: { not: null }, nextTierOn: { not: null } },
    select: { id: true, name: true, tier: true, laterUntil: true, nextTier: true, nextTierOn: true },
  })
  if (!planned.length) return 0
  const todayKey = todayKeyInTz(await getUserTimezone(userId), now)
  let applied = 0
  for (const a of planned) {
    // The day is stored as midnight UTC of the chosen date, so its UTC key is that date.
    if (!plannedDue(utcDayKey(a.nextTierOn!), todayKey)) continue
    await prisma.area.update({ where: { id: a.id }, data: { tier: a.nextTier!, laterUntil: null, nextTier: null, nextTierOn: null } })
    // Undo puts back the old mode and the plan, so it would apply again next time; that is the honest reverse.
    await recordActivity(userId, {
      type: "UPDATED",
      itemType: "SETTING",
      itemId: a.id,
      title: `${a.name} is now ${LABEL[modeOfTier(a.nextTier!)]}, as planned`,
      source: "APP",
      undo: {
        kind: "RESTORE_FIELDS",
        model: "area",
        id: a.id,
        prev: { tier: a.tier, laterUntil: a.laterUntil ? a.laterUntil.toISOString() : null },
      },
    })
    applied++
  }
  return applied
}
