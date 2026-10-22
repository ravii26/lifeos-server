import { randomUUID } from "node:crypto"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import app from "../../app.js"
import prisma from "../../lib/prisma.js"

// Phase C (ADR 0027): the proactive agenda and talking like a person, all by
// code (no AI needed for any of these).
describe("Phase C: agenda and follow-ups", () => {
  const email = `phase-c-${randomUUID()}@test.local`
  let token: string
  let userId: string
  let areaId: string
  const auth = () => ({ Authorization: `Bearer ${token}` })
  const say = (message: string, history: unknown[] = []) => request(app).post("/api/v1/assistant/chat").set(auth()).send({ message, history })
  const turn = (refs: unknown[]) => [{ role: "user", text: "…" }, { role: "assistant", text: "Done.", refs }]

  beforeAll(async () => {
    const reg = await request(app).post("/api/v1/auth/register").send({ email, password: "password123", name: "Phase C" })
    token = reg.body.data.token
    userId = reg.body.data.user.id
    await request(app).put("/api/v1/now/basics").set(auth()).send({ wake: "07:00", sleep: "00:00", officeDays: [1, 2, 3, 4, 5], office: { start: "10:00", end: "20:30" } }).expect(200)
    const area = await request(app).post("/api/v1/areas").set(auth()).send({ name: "Health", color: "#3a7", icon: "h", tier: "MAIN" })
    areaId = area.body.data.id
  })

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("the agenda: a briefing at wake time, a wrap-up before sleep, and the level switch", async () => {
    await request(app).post("/api/v1/habits").set(auth()).send({ title: "Gym session", areaId, timeBlock: "EVENING", targetMinutes: 45, reminderTime: "20:00" }).expect(201)
    const a = await request(app).get("/api/v1/now/agenda").query({ at: "2026-10-20T06:00" }).set(auth())
    expect(a.status).toBe(200)
    const kinds = a.body.data.items.filter((i: { dayKey: string }) => i.dayKey === "2026-10-20").map((i: { kind: string }) => i.kind)
    expect(kinds[0]).toBe("BRIEFING")
    expect(kinds).toContain("WRAP_UP")
    expect(kinds).toContain("SLOT")
    expect(a.body.data.items[0].body).toContain("Office 10 am–8:30 pm.")

    await request(app).put("/api/v1/now/proactivity").set(auth()).send({ level: "QUIETER" }).expect(200)
    const q = await request(app).get("/api/v1/now/agenda").query({ at: "2026-10-20T06:00" }).set(auth())
    expect(q.body.data.items.some((i: { kind: string }) => i.kind === "SLOT")).toBe(false)

    await request(app).put("/api/v1/now/proactivity").set(auth()).send({ level: "SILENT" }).expect(200)
    const s = await request(app).get("/api/v1/now/agenda").query({ at: "2026-10-20T06:00" }).set(auth())
    expect(s.body.data.items).toEqual([])
    await request(app).put("/api/v1/now/proactivity").set(auth()).send({ level: "NORMAL" }).expect(200)
  })

  it("'move it to Friday', then 'change it to 7 pm', then 'undo that'", async () => {
    const remindAt = new Date(Date.now() + 2 * 86_400_000)
    remindAt.setUTCHours(12, 30, 0, 0) // 6 pm IST
    const task = await request(app).post("/api/v1/tasks").set(auth()).send({ title: "Call mom", remindAt: remindAt.toISOString() })
    const id = task.body.data.id

    const moved = await say("move it to Friday", turn([{ type: "TASK", id, title: "Call mom" }]))
    expect(moved.status).toBe(200)
    const upd = moved.body.data.actions[0]
    expect(upd).toMatchObject({ type: "ITEM_UPDATED", itemType: "TASK", id })
    expect(new Date(upd.remindAt).getUTCDay()).toBe(5)
    expect(moved.body.data.usedAi).toBe(false)

    const retimed = await say("change it to 7 pm", turn([{ type: "TASK", id, title: "Call mom", activityId: upd.activityId }]))
    const r = retimed.body.data.actions[0]
    expect(new Date(r.remindAt).toISOString().slice(11, 16)).toBe("13:30") // 7 pm IST

    const undone = await say("undo that", turn([{ type: "TASK", id, title: "Call mom", activityId: r.activityId }]))
    expect(undone.body.data.actions[0]).toMatchObject({ type: "UNDONE", id })
    const back = await prisma.task.findUnique({ where: { id } })
    expect(back!.remindAt!.toISOString().slice(11, 16)).toBe("12:30")
  })

  it("'make it 30 min' resizes the habit just made", async () => {
    const h = await prisma.habit.findFirst({ where: { userId, title: "Gym session" } })
    const res = await say("make it 30 min", turn([{ type: "HABIT", id: h!.id, title: "Gym session" }]))
    expect(res.body.data.actions[0]).toMatchObject({ type: "ITEM_UPDATED", itemType: "HABIT", detail: "30 min" })
    expect((await prisma.habit.findUnique({ where: { id: h!.id } }))!.targetMinutes).toBe(30)
  })

  it("'no, gym is at 9 not 8' fixes the habit's time", async () => {
    const res = await say("no, gym is at 9 not 8")
    expect(res.body.data.actions[0]).toMatchObject({ type: "ITEM_UPDATED", itemType: "HABIT", reminderTime: "21:00" })
  })

  it("questions from real data", async () => {
    const day = await say("what's my day?")
    expect(day.body.data.usedAi).toBe(false)
    expect(day.body.data.reply).toMatch(/rest of today|Nothing else planned/)
    const done = await say("what did I do yesterday?")
    expect(done.body.data.reply).toMatch(/Yesterday you did|Nothing logged yesterday/)
    const track = await say("am I on track?")
    expect(track.body.data.reply).toMatch(/plan one|Here's where you stand|this week/)
  })

  it("a plan just proposed is changed by talking (AI)", async () => {
    const first = await say("Make me a plan for this goal: learn guitar. I want it done in 3 months, by 20 Jan 2027.")
    const plan = first.body.data.actions.find((a: { type: string }) => a.type === "GOAL_PLAN")
    expect(plan).toBeTruthy()
    const changed = await say("make it only 3 evenings a week", turn([{ type: "GOAL_PLAN", goalText: plan.goalText }]))
    const again = changed.body.data.actions.find((a: { type: string }) => a.type === "GOAL_PLAN")
    expect(again?.goalText).toContain("Change: make it only 3 evenings a week")
    expect(await prisma.project.count({ where: { userId } })).toBe(0)
  })

  it("wrap-up's 'Move to tomorrow' moves today's open to-dos, undoably", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
    await request(app).post("/api/v1/tasks").set(auth()).send({ title: "Clean desk", dueDate: today })
    const res = await request(app).post("/api/v1/now/wrapup/move").set(auth())
    expect(res.body.data.moved).toBeGreaterThanOrEqual(1)
    await request(app).post(`/api/v1/activity/${res.body.data.activityId}/undo`).set(auth()).expect(200)
  })
})
