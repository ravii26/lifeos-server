/* =====================================================================
   Acts on season phrases from chat ("park money until March", "make
   English my focus"). Code only, no AI, always with Undo. Returns null
   when the words don't clearly name one of the person's areas, so the
   rest of the chat pipeline decides.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import { todayKeyInTz } from "../../shared/utils/time.util.js"
import type { ChatResult } from "../assistant/assistant.chat.js"
import { moveAreaService } from "./season.service.js"
import { seasonIntent, returnDate, matchAreas } from "./season.phrases.js"

const reply = (text: string, actions: ChatResult["actions"] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })

const dateLabel = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

export const seasonChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const intent = seasonIntent(text)
  if (!intent) return null
  const areas = await prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true } })
  const found = matchAreas(intent.name, areas)
  if (!found.length) return null // not an area: maybe a goal or habit, so other handlers try
  if (found.length > 1) {
    const verb = intent.kind === "PARK" ? "Park" : "Make"
    return reply("Which one?", [
      {
        type: "ASK",
        question: "Which one?",
        options: found.slice(0, 5).map((a) => ({
          id: a.id,
          title: intent.kind === "PARK" ? `${verb} ${a.name}${intent.when ? ` until ${intent.when}` : ""}` : `${verb} ${a.name} my focus`,
          command: true,
        })),
      },
    ])
  }
  const area = found[0]!

  if (intent.kind === "PARK") {
    const until = returnDate(intent.when, todayKeyInTz(await getUserTimezone(userId)))
    const r = await moveAreaService(userId, area.id, { tier: "LATER", laterUntil: until ? new Date(`${until}T00:00:00Z`) : null })
    const when = until ? `until ${dateLabel(until)}` : "until you bring it back"
    return reply(`Parked ${area.name} ${when}. It won't show on Now, and nothing is deleted.`, [
      { type: "ITEM_UPDATED", itemType: "AREA", id: area.id, title: area.name, detail: `parked ${when}`, ...(r.moved && r.activityId && { activityId: r.activityId }) },
    ])
  }

  const out = intent.instead ? matchAreas(intent.instead, areas) : []
  if (intent.instead && out.length !== 1) return reply(`I couldn't tell which area "${intent.instead}" is. Try its exact name.`)
  const r = await moveAreaService(userId, area.id, { tier: "MAIN", ...(out[0] && { swapOutId: out[0].id }) })
  if (!r.moved) {
    // Never a silent third focus: the person picks what makes room.
    return reply(`That would be a third focus. ${r.current.map((c) => c.name).join(" and ")} are in focus now. Which one makes room? It gets parked, not deleted.`, [
      {
        type: "ASK",
        question: "Which one makes room?",
        options: r.current.map((c) => ({ id: c.id, title: `Make ${area.name} my focus instead of ${c.name}`, command: true })),
      },
    ])
  }
  const detail = out[0] ? `now in focus; ${out[0].name} parked` : "now in focus"
  return reply(`${area.name} is in focus now.${out[0] ? ` ${out[0].name} is parked, and nothing is lost.` : ""}`, [
    { type: "ITEM_UPDATED", itemType: "AREA", id: area.id, title: area.name, detail, ...(r.activityId && { activityId: r.activityId }) },
  ])
}
