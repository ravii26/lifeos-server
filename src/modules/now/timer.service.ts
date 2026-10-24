/* =====================================================================
   The running timer on Now (Phase D slice D8, ADR 0045): the label and
   how long it has been, so the phone can show a bar with Stop. Null when
   no timer is running.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { elapsedMinutes, isForgotten } from "../log/time.rules.js"

export interface NowTimer {
  id: string
  label: string
  startedAt: string
  minutes: number
  forgotten: boolean
}

export const timerNowService = async (userId: string): Promise<NowTimer | null> => {
  const t = await prisma.timeEntry.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: "desc" } })
  if (!t) return null
  const minutes = elapsedMinutes(t.startedAt, new Date())
  return { id: t.id, label: t.label, startedAt: t.startedAt.toISOString(), minutes, forgotten: isForgotten(minutes) }
}
