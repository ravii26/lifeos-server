/* =====================================================================
   Saves in chat (Phase D slices D6 and D7, ADRs 0043 and 0044):
   Watch later ("show watch later", "I watched Atomic Habits"), what
   became of the saves ("how many saves did I act on this week"), the ones
   undecided for a month ("still want these?", "let go of old saves"),
   sharing several links at once, and "put the rest in watch later".
   All code; the only AI is the one triage call when several links are
   shared. Only the person's own saves are touched.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { listQueueService, markWatchedService, removeFromQueueService } from "../guide/guide.saves.service.js"
import { findQueueItem, queueIntent, queueReply } from "../guide/saves.later.rules.js"
import { staleReply, summaryIntent, summaryReply } from "../guide/saves.summary.rules.js"
import { batchSavesService, letGoStaleService, restToLaterService, savesSummaryService, staleSavesService } from "../guide/saves.batch.service.js"
import type { ChatResult } from "./assistant.chat.js"

const reply = (text: string, actions: ChatResult["actions"] = [], usedAi = false): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi })

const URLS = /https?:\/\/[^\s<>"']+/gi

export const urlsIn = (text: string): string[] => [...new Set(text.match(URLS) ?? [])]

// Several links in one message: saved together, triaged in one AI call, nothing acted on.
export const batchShareChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const urls = urlsIn(text)
  if (urls.length < 2) return null
  const r = await batchSavesService(userId, urls.slice(0, 10))
  const names = (xs: { title: string }[]) => xs.slice(0, 4).map((x) => x.title).join("; ") + (xs.length > 4 ? `; and ${xs.length - 4} more` : "")
  const parts = [
    `Saved ${r.total}.`,
    r.matters.length ? `${r.matters.length} look useful for your goals: ${names(r.matters)}.` : "None clearly fit your goals right now.",
    r.later.length ? `${r.later.length === 1 ? "The other one" : `The other ${r.later.length}`} can wait: ${names(r.later)}.` : "",
    r.total > 0 ? "Nothing is acted on until you choose." : "",
  ].filter(Boolean)
  const actions: ChatResult["actions"] = r.later.length
    ? [{ type: "ASK", question: "What should happen to the ones that can wait?", options: [{ id: "later", title: `Put the other ${r.later.length} in watch later`, command: true }] }]
    : []
  return reply(parts.join(" "), actions, true)
}

export const savesChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const s = summaryIntent(text)
  if (s) {
    if (s.kind === "SUMMARY") return reply(summaryReply(await savesSummaryService(userId, s.days), s.days))
    if (s.kind === "STALE") return reply(staleReply(await staleSavesService(userId)))
    if (s.kind === "LET_GO_STALE") {
      const stale = await staleSavesService(userId)
      if (!stale.length) return reply("Nothing has been waiting more than a month.")
      const ids = stale.map((x) => x.id)
      await letGoStaleService(userId)
      const event = await recordActivity(userId, { type: "ARCHIVED", itemType: "SAVE", title: `Let go of ${ids.length} old save${ids.length === 1 ? "" : "s"}`, source: "CHAT", undo: { kind: "RESET_SAVES", ids } })
      return reply(`Let go of ${ids.length} old save${ids.length === 1 ? "" : "s"}. Tap Undo if you change your mind.`, [{ type: "SAVES_MOVED", title: event?.title ?? "Let go of old saves", activityId: event?.id }])
    }
    // REST_TO_LATER
    const before = await prisma.capture.findMany({ where: { userId, status: "PENDING", suggestedOutputs: { path: ["triage"], equals: "LATER" } }, select: { id: true } })
    const moved = await restToLaterService(userId)
    if (!moved.count) return reply("Nothing is waiting to be moved.")
    const event = await recordActivity(userId, { type: "UPDATED", itemType: "SAVE", title: `Put ${moved.count} in watch later`, source: "CHAT", undo: { kind: "RESET_SAVES", ids: before.map((b) => b.id) } })
    return reply(`Put ${moved.count} in watch later. Say "show watch later" to see them.`, [{ type: "SAVES_MOVED", title: event?.title ?? "Put in watch later", activityId: event?.id }])
  }

  const intent = queueIntent(text)
  if (!intent) return null
  const queue = await listQueueService(userId)
  if (intent.kind === "SHOW") return reply(queueReply(queue))
  const item = findQueueItem(intent.name, queue)
  if (!item) return null
  if (intent.kind === "WATCHED") {
    await markWatchedService(userId, item.captureId)
    return reply(`Nice. Took "${item.title}" off your watch later. ${queue.length - 1} left.`)
  }
  await removeFromQueueService(userId, item.captureId)
  return reply(`Removed "${item.title}" from your watch later. ${queue.length - 1} left.`)
}
