import { randomUUID } from "node:crypto"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import app from "../../app.js"
import prisma from "../../lib/prisma.js"

describe("Assistant Capture Integration (Jarvis)", () => {
  const email = `assistant-test-${randomUUID()}@test.local`
  let token: string
  let userId: string

  beforeAll(async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "password123",
      name: "Assistant Test User",
    })
    expect(res.status).toBe(201)
    token = res.body.data.token
    userId = res.body.data.user.id
  })

  afterAll(async () => {
    // Clean up DB entries
    await prisma.capture.deleteMany({ where: { userId } })
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("handles a capture intent message and creates a prospective capture entry", async () => {
    const message = "Please add a task to water the plants tomorrow"
    const res = await request(app)
      .post("/api/v1/assistant/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ message })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const answer = res.body.data.answer
    expect(
      answer.includes("I've saved that as a prospective task in your inbox") ||
      answer.includes("I've created a task for you")
    ).toBe(true)

    // Check if the capture is stored in the database
    const captures = await prisma.capture.findMany({ where: { userId } })
    expect(captures.length).toBe(1)
    expect(captures[0].rawText).toBe(message)
    expect(["PENDING", "CONVERTED"]).toContain(captures[0].status)
  })

  it("routes non-capture intent messages to the standard QA/decision flows", async () => {
    const message = "What are my goals?"
    const res = await request(app)
      .post("/api/v1/assistant/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ message })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // Verify it routed to standard QA/briefing (not capture) by checking that capture phrases aren't present
    const answer = res.body.data.answer
    expect(answer).not.toContain("saved that as a prospective")
    expect(answer).not.toContain("created a task")

    // Verify no new capture was created
    const captures = await prisma.capture.findMany({ where: { userId } })
    expect(captures.length).toBe(1) // Still just the one from the previous test
  })

  it("incorporates conversation history into standard QA responses", async () => {
    const history = [
      { role: "user" as const, text: "I have a goals question." },
      { role: "assistant" as const, text: "Sure! Ask me anything about your goals." },
    ]
    const message = "Tell me about them."
    const res = await request(app)
      .post("/api/v1/assistant/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ message, history })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const answer = res.body.data.answer.toLowerCase()
    expect(answer).toContain("goal")
  })
})
