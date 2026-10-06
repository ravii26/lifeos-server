import { randomUUID } from "node:crypto"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import app from "../../app.js"
import prisma from "../../lib/prisma.js"

// Every action lands in the activity log, and Undo restores the exact
// previous state, including chained effects (a Done that completed a task).
describe("Activity log and undo", () => {
  const email = `activity-${randomUUID()}@test.local`
  let token: string
  let userId: string
  const auth = () => ({ Authorization: `Bearer ${token}` })
  const events = async () => (await request(app).get("/api/v1/activity?days=1").set(auth())).body.data as {
    id: string
    type: string
    itemType: string
    itemId: string
    undoneAt: string | null
  }[]

  beforeAll(async () => {
    const reg = await request(app).post("/api/v1/auth/register").send({ email, password: "password123", name: "Activity Test" })
    token = reg.body.data.token
    userId = reg.body.data.user.id
    await request(app).post("/api/v1/areas").set(auth()).send({ name: "Career", color: "#4b55d6", icon: "b", tier: "MAIN" })
  })

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("logs creating and completing a to-do, and undo reverses each step", async () => {
    const created = await request(app).post("/api/v1/tasks").set(auth()).send({ title: "Update resume" })
    const taskId = created.body.data.id
    expect(created.body.data.activityId).toBeTruthy()

    const done = await request(app).patch(`/api/v1/tasks/${taskId}/complete`).set(auth())
    expect(done.body.data.status).toBe("COMPLETED")

    const log = await events()
    const doneEvent = log.find((e) => e.type === "DONE" && e.itemId === taskId)!
    expect(log.some((e) => e.type === "CREATED" && e.itemId === taskId)).toBe(true)

    await request(app).post(`/api/v1/activity/${doneEvent.id}/undo`).set(auth()).expect(200)
    const reopened = await prisma.task.findUnique({ where: { id: taskId } })
    expect(reopened?.status).toBe("TODO")
    expect(reopened?.completedAt).toBeNull()

    // The same step can't be undone twice.
    await request(app).post(`/api/v1/activity/${doneEvent.id}/undo`).set(auth()).expect(422)

    await request(app).post(`/api/v1/activity/${created.body.data.activityId}/undo`).set(auth()).expect(200)
    const archived = await prisma.task.findUnique({ where: { id: taskId } })
    expect(archived?.archivedAt).not.toBeNull()
  })

  it("undoing a 'Done' on today's pick also reopens the task it completed", async () => {
    await request(app).post("/api/v1/tasks").set(auth()).send({ title: "Solve one array problem", priority: "HIGH" })
    const tonight = await request(app).get("/api/v1/guide/tonight").set(auth())
    const pickId = tonight.body.data.commitment.sourceId

    const answered = await request(app).post("/api/v1/guide/tonight/respond").set(auth()).send({ status: "DONE" })
    expect((await prisma.task.findUnique({ where: { id: pickId } }))?.status).toBe("COMPLETED")

    await request(app).post(`/api/v1/activity/${answered.body.data.activityId}/undo`).set(auth()).expect(200)
    expect((await prisma.task.findUnique({ where: { id: pickId } }))?.status).toBe("TODO")
    const again = await request(app).get("/api/v1/guide/tonight").set(auth())
    expect(again.body.data.commitment.status).toBe("PENDING")
  })

  it("skips keep their reason in history", async () => {
    await request(app).post("/api/v1/guide/tonight/respond").set(auth()).send({ status: "SKIPPED", reason: "Too tired" })
    const skip = (await events()).find((e) => e.type === "SKIPPED")
    expect(skip).toBeTruthy()
    const row = await prisma.activityEvent.findUnique({ where: { id: skip!.id } })
    expect(row?.reason).toBe("Too tired")
  })

  it("reminders are to-dos with a time, listed for the phone, and undo removes them", async () => {
    const remindAt = new Date(Date.now() + 3 * 3600_000).toISOString()
    const created = await request(app).post("/api/v1/tasks").set(auth()).send({ title: "Call mom", remindAt, source: "REMINDER" })
    let list = await request(app).get("/api/v1/assistant/reminders").set(auth())
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(created.body.data.id)
    expect(list.body.data[0].text).toBe("Call mom")

    await request(app).post(`/api/v1/activity/${created.body.data.activityId}/undo`).set(auth()).expect(200)
    list = await request(app).get("/api/v1/assistant/reminders").set(auth())
    expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(created.body.data.id)
  })

  it("never lets one user undo another user's action", async () => {
    const other = await request(app).post("/api/v1/auth/register").send({ email: `activity-other-${randomUUID()}@test.local`, password: "password123", name: "Other" })
    const mine = (await events())[0]!
    await request(app).post(`/api/v1/activity/${mine.id}/undo`).set({ Authorization: `Bearer ${other.body.data.token}` }).expect(404)
    await prisma.user.delete({ where: { id: other.body.data.user.id } })
  })
})
