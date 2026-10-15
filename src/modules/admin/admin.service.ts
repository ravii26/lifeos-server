import prisma from "../../lib/prisma.js"
import { env } from "../../config/env.config.js"
import { modelPrices } from "../../config/ai-prices.js"
import { summarizeAiCalls } from "./admin.rules.js"

// The admin page reads days in the founder's time zone.
const ADMIN_TZ = "Asia/Kolkata"
const MAX_ROWS = 50_000

const emailsFor = async (ids: (string | null)[]) => {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))]
  if (!wanted.length) return new Map<string, string>()
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, email: true } })
  return new Map(users.map((u) => [u.id, u.email]))
}

// GET /admin/ai/summary: cost, tokens and failures for the last 30 days.
export const aiSummaryService = async () => {
  const now = new Date()
  const rows = await prisma.aiCall.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - 31 * 86_400_000) } },
    select: { userId: true, feature: true, provider: true, model: true, tokensIn: true, tokensOut: true, durationMs: true, ok: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
  })
  const summary = summarizeAiCalls(rows, { now, timeZone: ADMIN_TZ, prices: modelPrices(), usdInr: env.AI_USD_INR })
  const emails = await emailsFor(summary.byUser.map((u) => u.userId))
  return {
    ...summary,
    byUser: summary.byUser.slice(0, 20).map((u) => ({ ...u, email: u.userId ? (emails.get(u.userId) ?? "deleted user") : "no user (background)" })),
    usdInr: env.AI_USD_INR,
    truncated: rows.length === MAX_ROWS,
  }
}

// GET /admin/ai/calls: the latest requests, newest first.
export const recentAiCallsService = async (limit: number, onlyFailures: boolean) => {
  const rows = await prisma.aiCall.findMany({
    where: onlyFailures ? { ok: false } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  const emails = await emailsFor(rows.map((r) => r.userId))
  return rows.map((r) => ({ ...r, email: r.userId ? (emails.get(r.userId) ?? null) : null }))
}

// GET /admin/saves: what people saved and what happened to it, so "is the
// YouTube summary working?" has an answer.
export const recentSavesService = async (limit: number) => {
  const rows = await prisma.capture.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      rawText: true,
      detectedUrl: true,
      purpose: true,
      status: true,
      summary: true,
      suggestedOutputs: true,
      createdOutputs: true,
      createdAt: true,
    },
  })
  const emails = await emailsFor(rows.map((r) => r.userId))
  return rows.map((r) => {
    const stored = (r.suggestedOutputs ?? {}) as { summary?: { state?: string; lines?: string[] }; proposal?: { contentTitle?: string } }
    const made = (r.createdOutputs ?? {}) as { taskIds?: string[]; habitIds?: string[]; noteId?: string | null; vaultItemId?: string }
    return {
      id: r.id,
      email: emails.get(r.userId) ?? null,
      title: stored.proposal?.contentTitle ?? r.rawText.slice(0, 120),
      url: r.detectedUrl,
      source: !r.detectedUrl ? "text" : /youtu/i.test(r.detectedUrl) ? "YouTube" : /instagram/i.test(r.detectedUrl) ? "Instagram" : "link",
      purpose: r.purpose,
      status: r.status,
      summaryState: stored.summary?.state ?? (r.summary ? "READY" : null),
      made: { tasks: made.taskIds?.length ?? 0, habits: made.habitIds?.length ?? 0, note: !!made.noteId, shelf: !!made.vaultItemId },
      createdAt: r.createdAt,
    }
  })
}

// GET /admin/overview: the headline numbers.
export const overviewService = async () => {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
  const [users, newUsers, activeRows, upcomingReminders, savesThisWeek] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.activityEvent.findMany({ where: { at: { gte: weekAgo } }, distinct: ["userId"], select: { userId: true } }),
    prisma.task.count({ where: { remindAt: { gte: now }, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null } }),
    prisma.capture.count({ where: { createdAt: { gte: weekAgo } } }),
  ])
  return { users, newUsers, activeThisWeek: activeRows.length, upcomingReminders, savesThisWeek }
}
