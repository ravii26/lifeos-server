/* =====================================================================
   Many saves at once, the saves summary and "still want these?"
   (Phase D slice D7, ADR 0044). Services over the saves; the wording and
   the counting are in saves.summary.rules.ts and guide.saves.batch.ts.
   ===================================================================== */
import { Prisma } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { createCapture, findCaptureById, updateCapture } from "../capture/capture.repository.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { extractUrl, heuristicProposal, readLink, typedFields, type LinkInfo, type SaveProposal } from "./guide.saves.ai.js"
import { MAX_BATCH, triageSaves, type BatchItem } from "./guide.saves.batch.js"
import { decideSaveService } from "./guide.saves.service.js"
import { countSaves, staleSaves, weekLine, type SaveRow } from "./saves.summary.rules.js"

export interface BatchResult {
  total: number
  matters: { id: string; title: string }[]
  later: { id: string; title: string }[]
}

interface StoredLite {
  kind?: string
  proposal?: { contentTitle?: string; lengthMinutes?: number | null }
  triage?: "MATTERS" | "LATER"
}

// Up to 10 shared items: read each title, triage them together in one AI call, save each as
// waiting for a decision. Nothing becomes an action here.
export const batchSavesService = async (userId: string, rawItems: string[]): Promise<BatchResult> => {
  const texts = rawItems.map((t) => t.trim()).filter(Boolean).slice(0, MAX_BATCH)
  if (texts.length < 1) throw new ValidationError("Share at least one link")
  const [areas, identity, links] = await Promise.all([
    prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true, tier: true } }),
    prisma.identity.findUnique({ where: { userId }, select: { thisYearGoal: true } }),
    Promise.all(texts.map((t) => { const u = extractUrl(t); return u ? readLink(u) : Promise.resolve<LinkInfo | null>(null) })),
  ])
  const items: BatchItem[] = texts.map((t, i) => ({
    n: i + 1,
    title: links[i]?.title ?? (t.replace(/https?:\/\/\S+/g, "").trim().slice(0, 120) || extractUrl(t) || "Saved item"),
    platform: links[i]?.platform ?? null,
    text: t.replace(/https?:\/\/\S+/g, "").trim(),
  }))
  const triage = await triageSaves(items, identity?.thisYearGoal ?? null, areas.map((a) => a.name))
  const byN = new Map(triage.map((t) => [t.n, t]))

  const result: BatchResult = { total: texts.length, matters: [], later: [] }
  for (const [i, text] of texts.entries()) {
    const t = byN.get(i + 1)
    const item = items[i]!
    const base = heuristicProposal({ text, link: links[i] ?? null, areas, yearGoal: identity?.thisYearGoal ?? null })
    const proposal: SaveProposal = {
      ...base,
      contentTitle: item.title.slice(0, 160),
      source: "heuristic",
      ...typedFields({ contentType: t?.contentType, domain: t?.domain, lengthMinutes: t?.lengthMinutes }, base.purpose, `${item.title} ${item.text}`),
    }
    const matters = t?.matters === true
    const url = extractUrl(text)
    const capture = await createCapture({
      userId,
      rawText: text.slice(0, 20_000),
      detectedUrl: url,
      urlMetadata: (links[i] ?? undefined) as Prisma.InputJsonValue | undefined,
      mediaType: "TEXT",
      status: "PENDING",
      purpose: proposal.purpose,
      feelings: proposal.feelings,
      suggestedOutputs: { kind: "SAVE", proposal, summary: { state: "NONE", lines: [] }, purposeBy: "ai", triage: matters ? "MATTERS" : "LATER" } as unknown as Prisma.InputJsonValue,
    })
    logBehavior(userId, "CAPTURE_CREATED", { captureId: capture.id, via: "batch" })
    ;(matters ? result.matters : result.later).push({ id: capture.id, title: proposal.contentTitle })
  }
  return result
}

// "Put the rest in watch later": every save from a batch that was triaged "can wait" and is still undecided.
export const restToLaterService = async (userId: string): Promise<{ count: number; titles: string[] }> => {
  const rows = await prisma.capture.findMany({
    where: { userId, status: "PENDING", suggestedOutputs: { path: ["triage"], equals: "LATER" } },
    orderBy: { createdAt: "desc" },
    take: MAX_BATCH * 3,
  })
  const titles: string[] = []
  for (const c of rows) {
    const stored = c.suggestedOutputs as StoredLite | null
    if (stored?.kind !== "SAVE") continue
    await decideSaveService(userId, c.id, { choice: "LATER", minutes: stored.proposal?.lengthMinutes ?? undefined })
    titles.push(stored.proposal?.contentTitle ?? "Saved item")
  }
  return { count: titles.length, titles }
}

// Several undecided or finished saves in one go: only to the queue or to "let go".
export const decideManyService = async (userId: string, ids: string[], choice: "LATER" | "DROP"): Promise<number> => {
  let done = 0
  for (const id of ids.slice(0, 30)) {
    const c = await findCaptureById(id, userId)
    if (!c || (c.suggestedOutputs as StoredLite | null)?.kind !== "SAVE" || c.status !== "PENDING") continue
    await decideSaveService(userId, id, { choice })
    done++
  }
  return done
}

// ---- summary and stale ------------------------------------------------------------------------------

const saveRows = async (userId: string, sinceDays: number): Promise<SaveRow[]> => {
  const rows = await prisma.capture.findMany({
    where: { userId, suggestedOutputs: { path: ["kind"], equals: "SAVE" }, createdAt: { gte: new Date(Date.now() - sinceDays * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: 500,
  })
  return rows.map((c) => ({
    id: c.id,
    title: (c.suggestedOutputs as StoredLite | null)?.proposal?.contentTitle ?? c.rawText.slice(0, 80),
    createdAt: c.createdAt,
    status: c.status,
    outcomeType: (c.createdOutputs as { type?: string } | null)?.type ?? null,
  }))
}

export const savesSummaryService = async (userId: string, days: number) => countSaves(await saveRows(userId, days), new Date(), days)

export const staleSavesService = async (userId: string) => staleSaves(await saveRows(userId, 365), new Date())

export const letGoStaleService = async (userId: string): Promise<number> => {
  const stale = await staleSavesService(userId)
  for (const s of stale) await updateCapture(s.id, userId, { status: "DISMISSED" })
  return stale.length
}

// One line for the Sunday review.
export const savesWeekLineService = async (userId: string): Promise<string | null> => weekLine(await savesSummaryService(userId, 7))
