/* =====================================================================
   The meal on Now (Phase D slice D3, ADR 0040): from the person's diet
   note, the meal being eaten or coming up at this hour. After 22:00 it is
   tomorrow's breakfast. Null when no diet is set or that meal has no entry.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { isDietMeta, mealFor, nextMealAt, type DietMeta, type Meal } from "../allynote/diet.rules.js"
import { getClock } from "./now.service.js"

export interface NowMeal {
  meal: Meal
  text: string
  tomorrow: boolean
}

export const mealNowService = async (userId: string, at?: string): Promise<NowMeal | null> => {
  const note = await prisma.allyNote.findFirst({ where: { userId, collection: "Diet", template: "ROUTINE" }, select: { meta: true } })
  if (!note || !isDietMeta(note.meta)) return null
  const c = await getClock(userId, at)
  const hour = Math.floor(c.nowMin / 60)
  const tomorrow = hour >= 22
  const meal = nextMealAt(hour)
  const text = mealFor(note.meta as DietMeta, tomorrow ? (c.weekday + 1) % 7 : c.weekday, meal)
  return text ? { meal, text, tomorrow } : null
}
