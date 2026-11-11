/* Runs the Ally scenario evals against the real AI and database configured
   in .env, using throwaway accounts that are deleted afterwards.
   Usage: npm run evals            (all ready scenarios)
          npm run evals -- F19 B2  (only these ids)
   Writes a JSON report to evals-reports/ and exits non-zero on any failure.
   It is also the cost bench: every scenario reports its AI calls, tokens,
   rupee cost and reply time, and the totals are compared with the previous
   full run, so a change that saves money but breaks answers shows at once. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import request from "supertest"
import app from "../app.js"
import prisma from "../lib/prisma.js"
import { costInr } from "../config/ai-prices.js"
import { scenarios, type ScenarioContext } from "./scenarios.js"
import { benchOf, compareBench, type BenchRow, type Spend } from "./bench.js"

// What one eval account spent on AI. The usage log is written without waiting, so give it a moment.
const spendOf = async (userId: string): Promise<Spend> => {
  await new Promise((r) => setTimeout(r, 800))
  const calls = await prisma.aiCall.findMany({ where: { userId }, select: { feature: true, model: true, tokensIn: true, tokensOut: true, ok: true } })
  let inr = 0
  let unpriced = 0
  for (const c of calls) {
    const cost = costInr(c.model, c.tokensIn, c.tokensOut)
    if (cost === null) unpriced++
    else inr += cost
  }
  return {
    calls: calls.length,
    failedCalls: calls.filter((c) => !c.ok).length,
    tokensIn: calls.reduce((a, c) => a + c.tokensIn, 0),
    tokensOut: calls.reduce((a, c) => a + c.tokensOut, 0),
    inr,
    unpricedCalls: unpriced,
    features: [...new Set(calls.map((c) => c.feature))],
  }
}

const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("-")))

const newContext = async (): Promise<{ ctx: ScenarioContext; cleanup: () => Promise<void> }> => {
  const email = `eval-${randomUUID()}@test.local`
  // One retry: a slow Neon wake-up or a rate limit should not lose the whole report.
  let reg = await request(app).post("/api/v1/auth/register").send({ email, password: "password123", name: "Eval" })
  if (!reg.body?.data?.token) {
    await new Promise((r) => setTimeout(r, 20_000))
    reg = await request(app).post("/api/v1/auth/register").send({ email, password: "password123", name: "Eval" })
  }
  if (!reg.body?.data?.token) throw new Error(`could not register an eval user (HTTP ${reg.status})`)
  const token = reg.body.data.token as string
  const userId = reg.body.data.user.id as string
  const auth = { Authorization: `Bearer ${token}` }
  await request(app).post("/api/v1/areas").set(auth).send({ name: "Career", color: "#4b55d6", icon: "b", tier: "MAIN" })

  const api: ScenarioContext["api"] = async (method, path, body) => {
    const res = await request(app)[method](`/api/v1${path}`).set(auth).send(body as object)
    return { status: res.status, body: res.body }
  }
  const history: { role: "user" | "assistant"; text: string }[] = []
  const say: ScenarioContext["say"] = async (message) => {
    // Like the app: the server reads the last 10 turns and rejects more than 20.
    const res = await api("post", "/assistant/chat", { message, history: history.slice(-10) })
    if (res.status !== 200) throw new Error(`chat returned ${res.status}`)
    history.push({ role: "user", text: message }, { role: "assistant", text: res.body.data.reply })
    return res.body.data
  }
  // A second phone: the same person logs in again and gets a fresh token.
  const newDevice: ScenarioContext["newDevice"] = async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: "password123" })
    const t = login.body?.data?.token as string | undefined
    if (!t) throw new Error(`login on a new device returned ${login.status}`)
    return async (method, path, body) => {
      const res = await request(app)[method](`/api/v1${path}`).set({ Authorization: `Bearer ${t}` }).send(body as object)
      return { status: res.status, body: res.body }
    }
  }
  return { ctx: { say, api, db: prisma, userId, newDevice }, cleanup: async () => void (await prisma.user.delete({ where: { id: userId } })) }
}

const main = async () => {
  const results: BenchRow[] = []

  for (const s of scenarios) {
    if (only.size && !only.has(s.id)) continue
    if (s.status !== "ready" || !s.run) {
      results.push({ id: s.id, name: s.name, result: "pending", detail: `build step ${typeof s.status === "object" ? s.status.pendingUntil : "?"}` })
      continue
    }
    let made: Awaited<ReturnType<typeof newContext>>
    try {
      made = await newContext()
    } catch (err) {
      results.push({ id: s.id, name: s.name, result: "error", detail: err instanceof Error ? err.message : String(err) })
      continue
    }
    const { ctx, cleanup } = made
    const started = Date.now()
    let usedAi = true
    const replyMs: number[] = []
    const tracked: ScenarioContext = {
      ...ctx,
      say: async (m) => {
        const t = Date.now()
        const r = await ctx.say(m)
        replyMs.push(Date.now() - t)
        usedAi = usedAi && r.usedAi !== false
        return r
      },
    }
    try {
      const failure = await s.run(tracked)
      const spend = await spendOf(ctx.userId).catch(() => undefined)
      results.push({ id: s.id, name: s.name, result: failure ? "fail" : "pass", detail: failure ?? undefined, ms: Date.now() - started, usedAi, replyMs, spend })
    } catch (err) {
      const spend = await spendOf(ctx.userId).catch(() => undefined)
      results.push({ id: s.id, name: s.name, result: "error", detail: err instanceof Error ? err.message : String(err), ms: Date.now() - started, usedAi, replyMs, spend })
    } finally {
      await cleanup().catch(() => undefined)
    }
  }

  const icon = { pass: "PASS   ", fail: "FAIL   ", pending: "pending", error: "ERROR  " } as const
  for (const r of results) {
    const ai = r.result === "pending" ? "" : r.usedAi ? "" : "  [no AI call]"
    const spent = r.spend ? `  [${r.spend.calls} AI, ${r.spend.tokensIn + r.spend.tokensOut} tok, ₹${r.spend.inr.toFixed(3)}]` : ""
    console.log(`${icon[r.result]}  ${r.id.padEnd(4)} ${r.name}${r.detail ? `  (${r.detail})` : ""}${ai}${spent}`)
  }
  const count = (k: string) => results.filter((r) => r.result === k).length
  console.log(`\n${count("pass")} passed · ${count("fail")} failed · ${count("error")} errors · ${count("pending")} pending (later build steps)`)

  mkdirSync("evals-reports", { recursive: true })
  // The bench: totals for this run, and against the last full run.
  const bench = benchOf(results)
  console.log(
    `\nBench: ${bench.messages} messages, ${bench.aiCalls} AI calls, ${bench.tokensPerMessage} tokens and ₹${bench.inrPerMessage.toFixed(3)} per message, ` +
      `replies p50 ${bench.replyP50Ms} ms / p90 ${bench.replyP90Ms} ms, total ₹${bench.inr.toFixed(2)}` +
      (bench.unpricedCalls ? ` (${bench.unpricedCalls} calls on models with no price set)` : ""),
  )
  if (!only.size) {
    for (const f of readdirSync("evals-reports").filter((n) => n.endsWith(".json")).sort().reverse()) {
      try {
        const old = JSON.parse(readFileSync(`evals-reports/${f}`, "utf8"))
        if (old?.bench) {
          console.log(compareBench(old.bench, bench, old.results ?? [], results))
          break
        }
      } catch {
        // An old or unreadable report is skipped.
      }
    }
  }
  writeFileSync(`evals-reports/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify({ bench, results }, null, 2))
  await prisma.$disconnect()
  process.exit(count("fail") + count("error") > 0 ? 1 : 0)
}

void main()
