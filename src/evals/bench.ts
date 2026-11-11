/* =====================================================================
   The cost bench: what the scenario run spent, per message, and how that
   compares with the last run. Pure functions so they are tested without
   a database or an AI key (bench.test.ts).
   ===================================================================== */

export interface Spend {
  calls: number
  failedCalls: number
  tokensIn: number
  tokensOut: number
  inr: number
  unpricedCalls: number
  features: string[]
}

export interface BenchRow {
  id: string
  name: string
  result: "pass" | "fail" | "pending" | "error"
  detail?: string
  ms?: number
  usedAi?: boolean
  replyMs?: number[]
  spend?: Spend
}

export interface Bench {
  scenarios: number
  passed: number
  messages: number
  aiCalls: number
  tokensIn: number
  tokensOut: number
  inr: number
  unpricedCalls: number
  tokensPerMessage: number
  inrPerMessage: number
  replyP50Ms: number
  replyP90Ms: number
}

export const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!
}

export const benchOf = (rows: BenchRow[]): Bench => {
  const ran = rows.filter((r) => r.result !== "pending")
  const replies = ran.flatMap((r) => r.replyMs ?? [])
  const sum = (f: (s: Spend) => number) => ran.reduce((a, r) => a + (r.spend ? f(r.spend) : 0), 0)
  const tokensIn = sum((s) => s.tokensIn)
  const tokensOut = sum((s) => s.tokensOut)
  const inr = sum((s) => s.inr)
  const messages = replies.length
  return {
    scenarios: ran.length,
    passed: ran.filter((r) => r.result === "pass").length,
    messages,
    aiCalls: sum((s) => s.calls),
    tokensIn,
    tokensOut,
    inr,
    unpricedCalls: sum((s) => s.unpricedCalls),
    tokensPerMessage: messages ? Math.round((tokensIn + tokensOut) / messages) : 0,
    inrPerMessage: messages ? inr / messages : 0,
    replyP50Ms: percentile(replies, 50),
    replyP90Ms: percentile(replies, 90),
  }
}

const pct = (before: number, after: number): string => {
  if (!before) return after ? "new" : "same"
  const d = Math.round(((after - before) / before) * 100)
  return d === 0 ? "same" : `${d > 0 ? "+" : ""}${d}%`
}

// One paragraph: did quality hold, and what happened to cost and speed.
export const compareBench = (before: Bench, after: Bench, beforeRows: BenchRow[] = [], afterRows: BenchRow[] = []): string => {
  const passedBefore = new Set(beforeRows.filter((r) => r.result === "pass").map((r) => r.id))
  const broke = afterRows.filter((r) => r.result !== "pass" && r.result !== "pending" && passedBefore.has(r.id)).map((r) => r.id)
  return [
    "Compared with the last run:",
    `  passed ${before.passed} -> ${after.passed}${broke.length ? `  (newly failing: ${broke.join(", ")})` : ""}`,
    `  tokens per message ${before.tokensPerMessage} -> ${after.tokensPerMessage} (${pct(before.tokensPerMessage, after.tokensPerMessage)})`,
    `  cost per message ₹${before.inrPerMessage.toFixed(3)} -> ₹${after.inrPerMessage.toFixed(3)} (${pct(before.inrPerMessage, after.inrPerMessage)})`,
    `  reply time p50 ${before.replyP50Ms} -> ${after.replyP50Ms} ms (${pct(before.replyP50Ms, after.replyP50Ms)}), p90 ${before.replyP90Ms} -> ${after.replyP90Ms} ms`,
  ].join("\n")
}
