import { randomUUID } from "node:crypto"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import app from "../../app.js"
import prisma from "../../lib/prisma.js"

// The app's guided starters (doc 17) send these exact phrasings. Each must
// land on the right action, or the first minute of a new user breaks.
describe("First-use starters", () => {
  const email = `starters-${randomUUID()}@test.local`
  let token: string
  let userId: string
  const auth = () => ({ Authorization: `Bearer ${token}` })
  const say = (message: string) => request(app).post("/api/v1/assistant/chat").set(auth()).send({ message, history: [] })
  const types = (res: request.Response) => (res.body.data.actions as { type: string }[]).map((a) => a.type)

  beforeAll(async () => {
    const reg = await request(app).post("/api/v1/auth/register").send({ email, password: "password123", name: "Starter Test" })
    token = reg.body.data.token
    userId = reg.body.data.user.id
  })

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("Plan a goal → a goal plan to keep, nothing saved yet", async () => {
    await request(app).put("/api/v1/now/basics").set(auth())
      .send({ wake: "07:30", sleep: "23:30", officeDays: [1, 2, 3, 4, 5], office: { start: "09:30", end: "18:30" } })
      .expect(200)
    const res = await say("Make me a plan for this goal: read more books. I want it done in 1 month, by 16 Nov 2026.")
    expect(types(res)).toContain("GOAL_PLAN")
    const proposal = res.body.data.actions.find((a: { type: string }) => a.type === "GOAL_PLAN").proposal
    expect(proposal.plan.deadline).toBe("2026-11-16")
    expect(proposal.plan.question ?? null).toBeNull()
    expect(await prisma.project.count({ where: { userId } })).toBe(0)
  })

  it("Remind me → a reminder at the chosen time", async () => {
    const res = await say("Remind me to call mom tomorrow at 9 am")
    const r = res.body.data.actions.find((a: { type: string }) => a.type === "REMINDER_SET")
    expect(r).toBeTruthy()
  })

  it("Remind me every day → a repeating reminder", async () => {
    const res = await say("Remind me to take vitamins every day at 9 am")
    const r = res.body.data.actions.find((a: { type: string }) => a.type === "REMINDER_SET")
    expect(r?.repeatRule).toMatch(/DAILY/)
  })

  it("Build a daily habit → a habit with its smallest version", async () => {
    const res = await say("Add a daily habit: Drink water, in the morning. Smallest version: one glass of water.")
    expect(types(res)).toContain("HABIT_ADDED")
    const h = await prisma.habit.findFirst({ where: { userId, title: { contains: "water", mode: "insensitive" } } })
    expect(h).toBeTruthy()
  })

  it("Teach Ally → a note it can answer from", async () => {
    const res = await say("Save a note. My breakfast options: poha, oats, eggs")
    expect(types(res)).toContain("NOTE_ADDED")
  })
})
