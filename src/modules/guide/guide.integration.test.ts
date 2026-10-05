import { randomUUID } from "node:crypto"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import app from "../../app.js"
import prisma from "../../lib/prisma.js"

// Full loop against the isolated `lifeos_test` database: pick → answer →
// side effects (task completed) → history → "one more".
describe("Guide: tonight's one thing (full request cycle)", () => {
  const email = `guide-${randomUUID()}@test.local`
  let token: string
  let userId: string
  let mainTaskId: string
  let otherTaskId: string

  const auth = () => ({ Authorization: `Bearer ${token}` })

  beforeAll(async () => {
    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "password123", name: "Guide Test User" })
    expect(reg.status).toBe(201)
    token = reg.body.data.token
    userId = reg.body.data.user.id

    const career = await request(app)
      .post("/api/v1/areas")
      .set(auth())
      .send({ name: "Career", color: "#4b55d6", icon: "briefcase", tier: "MAIN" })
    const health = await request(app)
      .post("/api/v1/areas")
      .set(auth())
      .send({ name: "Health", color: "#2e9e5b", icon: "heart", tier: "MAINTAIN" })
    expect(career.body.data.tier).toBe("MAIN")

    const main = await request(app)
      .post("/api/v1/tasks")
      .set(auth())
      .send({ title: "Solve one sliding-window problem", areaId: career.body.data.id, minimumVersion: "Read the problem" })
    const other = await request(app)
      .post("/api/v1/tasks")
      .set(auth())
      .send({ title: "Plan tomorrow's protein", areaId: health.body.data.id })
    mainTaskId = main.body.data.id
    otherTaskId = other.body.data.id
  })

  afterAll(async () => {
    await prisma.nightlyCommitment.deleteMany({ where: { userId } })
    await prisma.task.deleteMany({ where: { userId } })
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("picks the MAIN area's task, with its minimum, once per night", async () => {
    const first = await request(app).get("/api/v1/guide/tonight").set(auth())
    expect(first.status).toBe(200)
    const c = first.body.data.commitment
    expect(c.sourceId).toBe(mainTaskId)
    expect(c.status).toBe("PENDING")
    expect(c.minimum.length).toBeGreaterThan(0)

    const again = await request(app).get("/api/v1/guide/tonight").set(auth())
    expect(again.body.data.commitment.id).toBe(c.id)
  })

  it("swaps to the next option", async () => {
    const res = await request(app).post("/api/v1/guide/tonight/swap").set(auth())
    expect(res.body.data.commitment.sourceId).toBe(otherTaskId)
    await request(app).post("/api/v1/guide/tonight/swap").set(auth())
  })

  it("Done completes the task and shows in history", async () => {
    const tonight = await request(app).get("/api/v1/guide/tonight").set(auth())
    const res = await request(app)
      .post("/api/v1/guide/tonight/respond")
      .set(auth())
      .send({ status: "DONE" })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe("DONE")

    const task = await prisma.task.findUnique({ where: { id: tonight.body.data.commitment.sourceId } })
    expect(task?.status).toBe("COMPLETED")

    const history = await request(app).get("/api/v1/guide/history?days=7").set(auth())
    expect(history.body.data.followThroughDays).toBe(1)
  })

  it("offers one more after tonight is done", async () => {
    const res = await request(app).get("/api/v1/guide/next").set(auth())
    expect(res.status).toBe(200)
    expect(res.body.data === null || typeof res.body.data.title === "string").toBe(true)
  })

  it("turns a saved video into an action, and can make it tonight's thing", async () => {
    // Free tonight's slot first: the earlier test answered tonight already,
    // so move that answered pick to yesterday.
    await prisma.nightlyCommitment.updateMany({
      where: { userId },
      data: { date: new Date(Date.now() - 2 * 86_400_000) },
    })
    const save = await request(app)
      .post("/api/v1/guide/saves")
      .set(auth())
      .send({ text: "https://www.youtube.com/watch?v=dQw4w9WgXcQ sliding window explained" })
    expect(save.status).toBe(201)
    expect(save.body.data.proposal.action.length).toBeGreaterThan(0)
    expect(save.body.data.platform).toBe("YouTube")

    const decided = await request(app)
      .post(`/api/v1/guide/saves/${save.body.data.id}/decide`)
      .set(auth())
      .send({ choice: "ACTION", when: "TONIGHT", action: "Solve one sliding-window problem from the video" })
    expect(decided.status).toBe(200)
    expect(decided.body.data.setAsTonight).toBe(true)

    const tonight = await request(app).get("/api/v1/guide/tonight").set(auth())
    expect(tonight.body.data.commitment.sourceId).toBe(decided.body.data.taskId)

    const again = await request(app)
      .post(`/api/v1/guide/saves/${save.body.data.id}/decide`)
      .set(auth())
      .send({ choice: "DROP" })
    expect(again.status).toBe(422)
  })

  it("puts motivation on the hard-days shelf, or lets a save go", async () => {
    const shelf = await request(app).post("/api/v1/guide/saves").set(auth()).send({ text: "Never give up speech" })
    const shelved = await request(app)
      .post(`/api/v1/guide/saves/${shelf.body.data.id}/decide`)
      .set(auth())
      .send({ choice: "SHELF" })
    expect(shelved.body.data.vaultItemId).toBeTruthy()

    const drop = await request(app).post("/api/v1/guide/saves").set(auth()).send({ text: "funny cat reel" })
    const dropped = await request(app)
      .post(`/api/v1/guide/saves/${drop.body.data.id}/decide`)
      .set(auth())
      .send({ choice: "DROP" })
    expect(dropped.body.data.choice).toBe("DROP")
  })

  it("rejects an unknown answer", async () => {
    const res = await request(app)
      .post("/api/v1/guide/tonight/respond")
      .set(auth())
      .send({ status: "MAYBE" })
    expect(res.status).toBe(422)
  })
})
