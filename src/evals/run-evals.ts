/* Runs the Ally scenario evals against the real AI and database configured
   in .env, using throwaway accounts that are deleted afterwards.
   Usage: npm run evals            (all ready scenarios)
          npm run evals -- F19 B2  (only these ids)
   Writes a JSON report to evals-reports/ and exits non-zero on any failure. */
import { mkdirSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import request from "supertest"
import app from "../app.js"
import prisma from "../lib/prisma.js"
import { scenarios, type ScenarioContext } from "./scenarios.js"

const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("-")))

const newContext = async (): Promise<{ ctx: ScenarioContext; cleanup: () => Promise<void> }> => {
  const email = `eval-${randomUUID()}@test.local`
  const reg = await request(app).post("/api/v1/auth/register").send({ email, password: "password123", name: "Eval" })
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
    const res = await api("post", "/assistant/chat", { message, history })
    if (res.status !== 200) throw new Error(`chat returned ${res.status}`)
    history.push({ role: "user", text: message }, { role: "assistant", text: res.body.data.reply })
    return res.body.data
  }
  return { ctx: { say, api }, cleanup: async () => void (await prisma.user.delete({ where: { id: userId } })) }
}

const main = async () => {
  const results: { id: string; name: string; result: "pass" | "fail" | "pending" | "error"; detail?: string; ms?: number; usedAi?: boolean }[] = []

  for (const s of scenarios) {
    if (only.size && !only.has(s.id)) continue
    if (s.status !== "ready" || !s.run) {
      results.push({ id: s.id, name: s.name, result: "pending", detail: `build step ${typeof s.status === "object" ? s.status.pendingUntil : "?"}` })
      continue
    }
    const { ctx, cleanup } = await newContext()
    const started = Date.now()
    let usedAi = true
    const tracked: ScenarioContext = {
      ...ctx,
      say: async (m) => {
        const r = await ctx.say(m)
        usedAi = usedAi && r.usedAi !== false
        return r
      },
    }
    try {
      const failure = await s.run(tracked)
      results.push({ id: s.id, name: s.name, result: failure ? "fail" : "pass", detail: failure ?? undefined, ms: Date.now() - started, usedAi })
    } catch (err) {
      results.push({ id: s.id, name: s.name, result: "error", detail: err instanceof Error ? err.message : String(err), ms: Date.now() - started, usedAi })
    } finally {
      await cleanup().catch(() => undefined)
    }
  }

  const icon = { pass: "PASS   ", fail: "FAIL   ", pending: "pending", error: "ERROR  " } as const
  for (const r of results) {
    const ai = r.result === "pending" ? "" : r.usedAi ? "" : "  [no AI call]"
    console.log(`${icon[r.result]}  ${r.id.padEnd(4)} ${r.name}${r.detail ? `  (${r.detail})` : ""}${ai}`)
  }
  const count = (k: string) => results.filter((r) => r.result === k).length
  console.log(`\n${count("pass")} passed · ${count("fail")} failed · ${count("error")} errors · ${count("pending")} pending (later build steps)`)

  mkdirSync("evals-reports", { recursive: true })
  writeFileSync(`evals-reports/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify(results, null, 2))
  await prisma.$disconnect()
  process.exit(count("fail") + count("error") > 0 ? 1 : 0)
}

void main()
