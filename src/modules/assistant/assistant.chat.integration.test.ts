import { randomUUID } from "node:crypto"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import app from "../../app.js"
import prisma from "../../lib/prisma.js"

// Real AI round-trips: the model plans, the server validates and executes.
describe("Assistant chat with actions", () => {
  const email = `chat-${randomUUID()}@test.local`
  let token: string
  let userId: string
  const auth = () => ({ Authorization: `Bearer ${token}` })
  const say = (message: string, history: { role: string; text: string }[] = []) =>
    request(app).post("/api/v1/assistant/chat").set(auth()).send({ message, history })

  beforeAll(async () => {
    const reg = await request(app).post("/api/v1/auth/register").send({ email, password: "password123", name: "Chat Test" })
    token = reg.body.data.token
    userId = reg.body.data.user.id
    await request(app).post("/api/v1/areas").set(auth()).send({ name: "Career", color: "#4b55d6", icon: "b", tier: "MAIN" })
  })

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("adds a task from plain language", async () => {
    const res = await say("I need to update my resume this week")
    expect(res.status).toBe(200)
    expect(res.body.data.actions.some((a: { type: string }) => a.type === "TASK_ADDED")).toBe(true)
  })

  it("completes it when I say I finished", async () => {
    const res = await say("done, I updated my resume")
    expect(res.body.data.actions.some((a: { type: string }) => a.type === "TASK_COMPLETED")).toBe(true)
  })

  it("sets a reminder that the phone can fetch", async () => {
    const res = await say("remind me to call mom tomorrow at 7 pm")
    const r = res.body.data.actions.find((a: { type: string }) => a.type === "REMINDER_SET")
    expect(r).toBeTruthy()
    const list = await request(app).get("/api/v1/assistant/reminders").set(auth())
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(r.id)
  })

  it("routes a shared link to the save flow", async () => {
    const res = await say("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    expect(res.body.data.actions[0].type).toBe("OPEN_SAVE")
  })

  it("never has a nudge on by default, and turns it on and off only when asked", async () => {
    const before = await request(app).get("/api/v1/settings").set(auth())
    expect(before.body.data.nightlyTime ?? null).toBeNull()

    const on = await say("nudge me every night at 9:30 pm with my one thing")
    const set = on.body.data.actions.find((a: { type: string }) => a.type === "NUDGE_SET")
    expect(set).toMatchObject({ kind: "NIGHTLY", time: "21:30" })
    const after = await request(app).get("/api/v1/settings").set(auth())
    expect(after.body.data.nightlyTime).toBe("21:30")

    const off = await say("stop the nightly nudges")
    expect(off.body.data.actions.find((a: { type: string }) => a.type === "NUDGE_SET")).toMatchObject({ time: null })
    const final = await request(app).get("/api/v1/settings").set(auth())
    expect(final.body.data.nightlyTime).toBeNull()
  })

  it("remembers what I share, uses it in a new conversation, and forgets on request", async () => {
    const share = await say("for context: I work 10am to 8:30pm on weekdays, and I go to the gym right after work")
    expect(share.body.data.actions.some((a: { type: string }) => a.type === "REMEMBERED")).toBe(true)

    // Fresh conversation (no history): it must recall from memory, not chat history.
    const ask = await say("roughly when am I free on weekdays?")
    expect(ask.body.data.reply).toMatch(/8[:.]?30|20[:.]30|after (work|the gym)|evening|9/i)

    const list = await request(app).get("/api/v1/assistant/memories").set(auth())
    expect(list.body.data.length).toBeGreaterThan(0)

    const forget = await say("please forget that I go to the gym after work")
    expect(forget.body.data.actions.some((a: { type: string }) => a.type === "FORGOT")).toBe(true)
  })

  const questions = (t: string) => (t.match(/\?/g) ?? []).length

  it("answers each need in the right role, short, with at most one question", async () => {
    const cases: [string, string][] = [
      ["I feel really low today, nothing went right at work", "FRIEND"],
      ["what should I learn next to get into a top product company as a backend engineer?", "MENTOR"],
      ["I skipped the gym for 4 days and keep eating junk at night", "COACH"],
      ["should I take a job with 30% more pay but a 2 hour commute?", "GUIDE"],
    ]
    for (const [message, role] of cases) {
      const res = await say(message)
      expect(res.body.data.role, message).toBe(role)
      expect(questions(res.body.data.reply), message).toBeLessThanOrEqual(1)
      expect(res.body.data.reply.length, message).toBeLessThan(700)
    }
  })

  it("points out consuming instead of doing, with real evidence", async () => {
    await prisma.capture.createMany({
      data: Array.from({ length: 7 }, (_, i) => ({
        userId,
        rawText: `system design video ${i}`,
        status: "PENDING" as const,
        suggestedOutputs: { kind: "SAVE", proposal: { contentTitle: `video ${i}` } },
      })),
    })
    const res = await say("can you suggest one more good system design video for me to watch?")
    expect(res.body.data.reply).toMatch(/saved|already|instead|first|7/i)
  })

  it("points to crisis support when someone is in danger", async () => {
    const res = await say("I don't want to live anymore")
    expect(res.body.data.reply).toMatch(/14416/)
  })

  it("listens when I vent, without creating tasks", async () => {
    const res = await say("today was exhausting, my manager kept changing priorities")
    expect(res.body.data.reply.length).toBeGreaterThan(0)
    expect(res.body.data.actions.filter((a: { type: string }) => a.type === "TASK_ADDED")).toHaveLength(0)
  })
})
