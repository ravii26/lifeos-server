/* =====================================================================
   Diet and meals in chat (Phase D slice D3, ADR 0040): "Monday diet: oats
   and eggs for breakfast, dal rice for lunch", "what's for lunch?", "show
   my diet", "shopping list from my diet". The plan is one ROUTINE note in
   the collection "Diet"; its `meta` holds the day-by-day meals (see
   allynote/diet.rules.ts). Setting and asking are code; only "shopping list
   from my diet" calls the AI, and only when asked. Without a diet set,
   questions return null so "what can I eat for breakfast" still reaches
   the person's taught notes.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { createAllyNoteService, updateAllyNoteService } from "../allynote/allynote.service.js"
import {
  askReply,
  dayLabel,
  dietIntent,
  isDietMeta,
  mergeDiet,
  savedReply,
  weekMealTexts,
  weekReply,
  type DietIntent,
  type DietMeta,
} from "../allynote/diet.rules.js"
import { addedReply, resolveList } from "../allynote/lists.rules.js"
import { getClock } from "../now/now.service.js"
import { ingredientsFromMeals } from "./assistant.diet.ai.js"
import type { ChatResult } from "./assistant.chat.js"

const reply = (text: string, actions: ChatResult["actions"] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })

const loadDiet = async (userId: string) => {
  const note = await prisma.allyNote.findFirst({ where: { userId, collection: "Diet", template: "ROUTINE" } })
  return { note, meta: note && isDietMeta(note.meta) ? (note.meta as DietMeta) : null }
}

const updated = (n: { id: string; title: string; items: string[]; activityId?: string }): ChatResult["actions"] => [
  { type: "NOTE_UPDATED", id: n.id, title: n.title, items: n.items, activityId: n.activityId },
]

const save = async (userId: string, intent: Extract<DietIntent, { kind: "SET" }>): Promise<ChatResult> => {
  const { note, meta } = await loadDiet(userId)
  const next = mergeDiet(meta, intent.days, intent.meals)
  const out = note
    ? await updateAllyNoteService(userId, note.id, { meta: next }, { source: "CHAT" })
    : await createAllyNoteService(userId, { collection: "Diet", template: "ROUTINE", title: "My diet", meta: next }, { source: "CHAT" })
  if (!out) return reply("I couldn't save that. Try again.")
  return reply(savedReply(intent.days, intent.meals), updated(out))
}

const ask = async (userId: string, intent: Extract<DietIntent, { kind: "ASK" }>): Promise<ChatResult | null> => {
  const { meta } = await loadDiet(userId)
  if (!meta) return null // no diet set: the person's taught notes may answer
  const c = await getClock(userId)
  const weekday = intent.day === "TODAY" ? c.weekday : intent.day === "TOMORROW" ? (c.weekday + 1) % 7 : intent.day
  return reply(askReply(meta, weekday, dayLabel(intent.day), intent.meal))
}

const show = async (userId: string): Promise<ChatResult | null> => {
  const { meta } = await loadDiet(userId)
  return meta ? reply(weekReply(meta)) : reply(weekReply(null))
}

// The one AI call: ingredients for the week's meals, added to the shopping list.
const shopping = async (userId: string): Promise<ChatResult> => {
  const { meta } = await loadDiet(userId)
  const meals = weekMealTexts(meta)
  if (!meals.length) return reply('Set your diet first, for example "Monday diet: oats and eggs for breakfast, dal rice for lunch", then ask again.')
  const found = await ingredientsFromMeals(meals)
  const lists = await prisma.allyNote.findMany({ where: { userId, template: "LIST" }, select: { id: true, collection: true, title: true, items: true, done: true } })
  const list = resolveList("shopping", lists)
  const have = new Set((list?.items ?? []).map((i) => i.toLowerCase()))
  const added = found.items.filter((i) => !have.has(i.toLowerCase()))
  const already = found.items.filter((i) => have.has(i.toLowerCase()))
  if (!added.length) return reply(addedReply(list?.title ?? "Shopping list", [], already, list?.items.length ?? 0))
  const out = list
    ? await updateAllyNoteService(userId, list.id, { add: added }, { source: "CHAT" })
    : await createAllyNoteService(userId, { collection: "Shopping", template: "LIST", title: "Shopping list", items: added }, { source: "CHAT" })
  if (!out) return reply("I couldn't save the list. Try again.")
  const how = found.fromAi ? "Worked out from your week's meals. Check it, and say \"remove X from shopping\" for anything you already have." : "The AI isn't available right now, so these are your meal names split up. Say \"remove X from shopping\" for anything you already have."
  return { role: "ASSISTANT", reply: `${addedReply(out.title, added, already, out.items.length)} ${how}`, actions: updated(out), usedAi: found.fromAi }
}

export const dietChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const intent = dietIntent(text)
  if (!intent) return null
  switch (intent.kind) {
    case "SET":
      return save(userId, intent)
    case "ASK":
      return ask(userId, intent)
    case "SHOW":
      return show(userId)
    case "SHOPPING":
      return shopping(userId)
  }
}
