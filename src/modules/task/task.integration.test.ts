import { randomUUID } from "node:crypto"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import app from "../../app.js"
import prisma from "../../lib/prisma.js"

// Full request-cycle test locking in the controller/service/repository
// contract used across every module (task/habit/capture/document all follow
// this shape). Runs against the isolated `lifeos_test` database — see
// src/test/setupTestEnv.ts — never the real dev/prod DB.
describe("Task CRUD (full request cycle)", () => {
  const email = `task-crud-${randomUUID()}@test.local`
  let token: string
  let userId: string
  let taskId: string

  beforeAll(async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "password123",
      name: "Task CRUD Test User",
    })
    expect(res.status).toBe(201)
    token = res.body.data.token
    userId = res.body.data.user.id
  })

  afterAll(async () => {
    // Clean up everything this test created so re-runs stay idempotent.
    await prisma.task.deleteMany({ where: { userId } })
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("creates a task", async () => {
    const res = await request(app)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Write integration tests", priority: "HIGH" })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.title).toBe("Write integration tests")
    expect(res.body.data.status).toBe("TODO")
    taskId = res.body.data.id
  })

  it("lists the created task", async () => {
    const res = await request(app)
      .get("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)

    expect(res.status).toBe(200)
    const list = Array.isArray(res.body.data) ? res.body.data : res.body.data.data
    expect(list.some((t: { id: string }) => t.id === taskId)).toBe(true)
  })

  it("updates the task", async () => {
    const res = await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ priority: "LOW" })

    expect(res.status).toBe(200)
    expect(res.body.data.priority).toBe("LOW")
  })

  it("completes the task", async () => {
    const res = await request(app)
      .patch(`/api/v1/tasks/${taskId}/complete`)
      .set("Authorization", `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe("COMPLETED")
  })

  it("deletes the task", async () => {
    const res = await request(app)
      .delete(`/api/v1/tasks/${taskId}`)
      .set("Authorization", `Bearer ${token}`)
    expect(res.status).toBe(200)

    const getRes = await request(app)
      .get(`/api/v1/tasks/${taskId}`)
      .set("Authorization", `Bearer ${token}`)
    expect(getRes.status).toBe(404)
  })

  it("rejects requests with no auth token", async () => {
    const res = await request(app).get("/api/v1/tasks")
    expect(res.status).toBe(401)
  })
})
