/* =====================================================================
   Admin numbers, worked out from AiCall rows. Pure functions (no DB), so
   the totals and the cost maths are unit-tested.
   ===================================================================== */
import { costInr, type ModelPrice } from "../../config/ai-prices.js"
import { dayKeyInTz, todayKeyInTz, localDayStartMs } from "../../shared/utils/time.util.js"

export interface AiCallRow {
  userId: string | null
  feature: string
  provider: string
  model: string
  tokensIn: number
  tokensOut: number
  durationMs: number
  ok: boolean
  createdAt: Date
}

export interface Totals {
  calls: number
  failures: number
  tokensIn: number
  tokensOut: number
  // Only calls whose model has a price; `unpricedCalls` says how many were left out.
  costInr: number
  unpricedCalls: number
  avgMs: number
}

const empty = (): Totals => ({ calls: 0, failures: 0, tokensIn: 0, tokensOut: 0, costInr: 0, unpricedCalls: 0, avgMs: 0 })

interface Acc extends Totals {
  msSum: number
}

const add = (acc: Acc, row: AiCallRow, cost: number | null) => {
  acc.calls++
  if (!row.ok) acc.failures++
  acc.tokensIn += row.tokensIn
  acc.tokensOut += row.tokensOut
  acc.msSum += row.durationMs
  // A failed call is not billed, so it never counts as unpriced either.
  if (row.ok) {
    if (cost === null) acc.unpricedCalls++
    else acc.costInr += cost
  }
}

const finish = ({ msSum, ...t }: Acc): Totals => ({
  ...t,
  costInr: Math.round(t.costInr * 100) / 100,
  avgMs: t.calls ? Math.round(msSum / t.calls) : 0,
})

const acc = (): Acc => ({ ...empty(), msSum: 0 })

export interface AiSummary {
  today: Totals
  last7Days: Totals
  last30Days: Totals
  byFeature: (Totals & { feature: string })[]
  byModel: (Totals & { provider: string; model: string })[]
  byUser: (Totals & { userId: string | null })[]
  byDay: (Totals & { day: string })[]
  unpricedModels: string[]
}

export const summarizeAiCalls = (
  rows: AiCallRow[],
  opts: { now: Date; timeZone: string; prices: Record<string, ModelPrice>; usdInr: number },
): AiSummary => {
  const todayKey = todayKeyInTz(opts.timeZone, opts.now)
  const todayStart = localDayStartMs(todayKey, opts.timeZone)
  const weekStart = todayStart - 6 * 86_400_000
  const monthStart = todayStart - 29 * 86_400_000

  const today = acc()
  const week = acc()
  const month = acc()
  const features = new Map<string, Acc>()
  const models = new Map<string, Acc & { provider: string; model: string }>()
  const users = new Map<string | null, Acc>()
  const days = new Map<string, Acc>()
  const unpriced = new Set<string>()

  for (const row of rows) {
    const t = row.createdAt.getTime()
    if (t < monthStart) continue
    const cost = costInr(row.model, row.tokensIn, row.tokensOut, opts.prices, opts.usdInr)
    if (cost === null && row.ok) unpriced.add(row.model)

    add(month, row, cost)
    if (t >= weekStart) add(week, row, cost)
    if (t >= todayStart) add(today, row, cost)

    if (!features.has(row.feature)) features.set(row.feature, acc())
    add(features.get(row.feature)!, row, cost)

    const mk = `${row.provider}|${row.model}`
    if (!models.has(mk)) models.set(mk, { ...acc(), provider: row.provider, model: row.model })
    add(models.get(mk)!, row, cost)

    if (!users.has(row.userId)) users.set(row.userId, acc())
    add(users.get(row.userId)!, row, cost)

    const day = dayKeyInTz(row.createdAt, opts.timeZone)
    if (!days.has(day)) days.set(day, acc())
    add(days.get(day)!, row, cost)
  }

  // Most expensive first, then the busiest.
  const order = (a: Totals, b: Totals) => b.costInr - a.costInr || b.calls - a.calls

  return {
    today: finish(today),
    last7Days: finish(week),
    last30Days: finish(month),
    byFeature: [...features].map(([feature, a]) => ({ feature, ...finish(a) })).sort(order),
    byModel: [...models.values()].map(({ provider, model, ...a }) => ({ provider, model, ...finish(a) })).sort(order),
    byUser: [...users].map(([userId, a]) => ({ userId, ...finish(a) })).sort(order),
    byDay: [...days].map(([day, a]) => ({ day, ...finish(a) })).sort((a, b) => a.day.localeCompare(b.day)),
    unpricedModels: [...unpriced].sort(),
  }
}

// "a@x.com, B@y.com" → is this email one of them (case-insensitive)?
export const isAdminEmail = (email: string | undefined, list: string | undefined): boolean => {
  if (!email || !list) return false
  const wanted = list.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  return wanted.includes(email.trim().toLowerCase())
}
