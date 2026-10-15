import { randomUUID } from "node:crypto"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import app from "../../app.js"
import prisma from "../../lib/prisma.js"
import { env } from "../../config/env.config.js"
import { recordAiCall, withAiFeature, withAiUser } from "../../lib/ai-usage.js"

// Phase A (doc 16): the AI usage log and admin page, reminders that keep
// coming after one is missed, the first-run day, links on habits, and your
// data (export / delete).
describe("Phase A: trust", () => {
  const email = `phase-a-${randomUUID()}@test.local`
  const other = `phase-a-other-${randomUUID()}@test.local`
  let token: string
  let otherToken: string
  let userId: string
  let otherId: string
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` })
  const savedAdmins = env.ADMIN_EMAILS

  beforeAll(async () => {
    const reg = await request(app).post("/api/v1/auth/register").send({ email, password: "password123", name: "Phase A" })
    token = reg.body.data.token
    userId = reg.body.data.user.id
    const reg2 = await request(app).post("/api/v1/auth/register").send({ email: other, password: "password123", name: "Not admin" })
    otherToken = reg2.body.data.token
    otherId = reg2.body.data.user.id
    env.ADMIN_EMAILS = email
  })

  afterAll(async () => {
    env.ADMIN_EMAILS = savedAdmins
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } })
    await prisma.$disconnect()
  })

  it("only admins can open the admin page, and /me says who is one", async () => {
    expect((await request(app).get("/api/v1/admin/overview").set(auth(otherToken))).status).toBe(403)
    const ok = await request(app).get("/api/v1/admin/overview").set(auth())
    expect(ok.status).toBe(200)
    expect(ok.body.data.users).toBeGreaterThanOrEqual(2)
    expect((await request(app).get("/api/v1/auth/me").set(auth())).body.data.isAdmin).toBe(true)
    expect((await request(app).get("/api/v1/auth/me").set(auth(otherToken))).body.data.isAdmin).toBe(false)
  })

  it("AI calls are logged with user and feature and show up in the summary", async () => {
    await withAiUser(userId, () =>
      withAiFeature("Phase A test", async () => {
        recordAiCall({ provider: "gemini", model: "gemini-3.5-flash-lite", tokensIn: 1000, tokensOut: 200, durationMs: 800, ok: true })
        recordAiCall({ provider: "groq", model: "openai/gpt-oss-120b", durationMs: 50, ok: false, error: "quota" })
      }),
    )
    // The log write is fire-and-forget; give it a moment.
    for (let i = 0; i < 20 && (await prisma.aiCall.count({ where: { userId } })) < 2; i++) await new Promise((r) => setTimeout(r, 250))

    const summary = (await request(app).get("/api/v1/admin/ai/summary").set(auth())).body.data
    const feature = summary.byFeature.find((f: { feature: string }) => f.feature === "Phase A test")
    expect(feature).toMatchObject({ calls: 2, failures: 1, tokensIn: 1000, tokensOut: 200 })
    expect(feature.costInr).toBeGreaterThan(0)
    expect(summary.byUser.some((u: { email: string }) => u.email === email)).toBe(true)

    const failures = (await request(app).get("/api/v1/admin/ai/calls?failures=true&limit=200").set(auth())).body.data
    expect(failures.some((c: { userId: string; error: string }) => c.userId === userId && c.error === "quota")).toBe(true)
  })

  it("a daily reminder that was ignored for days still has its next 7 times", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
    const created = await request(app)
      .post("/api/v1/tasks")
      .set(auth())
      .send({ title: "Drink water", remindAt: threeDaysAgo.toISOString(), repeatRule: "FREQ=DAILY" })
    expect(created.status).toBe(201)
    const list = (await request(app).get("/api/v1/assistant/reminders").set(auth())).body.data as {
      id: string
      remindAt: string
      occurrences: string[]
    }[]
    const water = list.find((r) => r.id === created.body.data.id)!
    expect(water).toBeTruthy()
    expect(water.occurrences).toHaveLength(7)
    expect(new Date(water.occurrences[0]!).getTime()).toBeGreaterThan(Date.now() - 60_000)
    expect(water.remindAt).toBe(water.occurrences[0])
  })

  it("first run sets the whole week from wake, sleep and office hours", async () => {
    const bad = await request(app)
      .put("/api/v1/now/basics")
      .set(auth())
      .send({ wake: "07:00", sleep: "23:30", officeDays: [1], office: { start: "05:00", end: "12:00" } })
    expect(bad.status).toBe(422)

    const res = await request(app)
      .put("/api/v1/now/basics")
      .set(auth())
      .send({ wake: "07:00", sleep: "23:30", officeDays: [1, 2, 3, 4, 5], office: { start: "10:00", end: "20:30" } })
    expect(res.status).toBe(200)
    const week = res.body.data as { weekday: number; custom: boolean; blocks: { block: string; start: string }[] }[]
    expect(week.every((d) => d.custom)).toBe(true)
    expect(week[1]!.blocks.some((b) => b.block === "OFFICE" && b.start === "10:00")).toBe(true)
    expect(week[0]!.blocks.some((b) => b.block === "OFFICE")).toBe(false)
    expect(week[0]!.blocks[0]).toMatchObject({ block: "MORNING", start: "07:00" })
  })

  it("a habit keeps the link it came from", async () => {
    const area = await request(app).post("/api/v1/areas").set(auth()).send({ name: "Health", color: "#4b55d6", icon: "h", tier: "MAIN" })
    const habit = await request(app)
      .post("/api/v1/habits")
      .set(auth())
      .send({ title: "10 min walk", areaId: area.body.data.id, sourceUrl: "https://www.instagram.com/reel/abc/" })
    expect(habit.status).toBe(201)
    expect(habit.body.data.sourceUrl).toBe("https://www.instagram.com/reel/abc/")
  })

  it("exports everything you own, and deletes only with the word DELETE", async () => {
    const exp = await request(app).get("/api/v1/auth/export").set(auth(otherToken))
    expect(exp.status).toBe(200)
    expect(exp.body.data.user.email).toBe(other)
    expect(exp.body.data.user.password).toBeUndefined()
    expect(Object.keys(exp.body.data.data)).toEqual(expect.arrayContaining(["Task", "Habit", "AiCall"]))

    const mine = await request(app).get("/api/v1/auth/export").set(auth())
    expect(mine.body.data.data.Task.some((t: { title: string }) => t.title === "Drink water")).toBe(true)

    expect((await request(app).delete("/api/v1/auth/account").set(auth(otherToken)).send({})).status).toBe(422)
    expect((await request(app).delete("/api/v1/auth/account").set(auth(otherToken)).send({ confirm: "DELETE" })).status).toBe(200)
    expect(await prisma.user.findUnique({ where: { id: otherId } })).toBeNull()
  })
})
