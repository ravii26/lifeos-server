import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { errorMiddleware } from "./error.middleware.js"
import { requestIdMiddleware } from "./requestId.middleware.js"
import { NotFoundError, ValidationError } from "../utils/errors.util.js"

// A minimal app wired the same way as src/app.ts (requestId -> routes -> error
// middleware last), but without DB/env-heavy real routes — keeps this a pure
// unit test of the error-handling contract.
const buildApp = () => {
  const app = express()
  app.use(requestIdMiddleware)

  app.get("/not-found", () => {
    throw new NotFoundError("Task not found")
  })
  app.get("/validation", () => {
    throw new ValidationError("Bad input", { field: "title" })
  })
  app.get("/boom", () => {
    throw new Error("unexpected failure")
  })

  app.use(errorMiddleware)
  return app
}

describe("errorMiddleware", () => {
  it("maps a NotFoundError to a 404 with the AppError message", async () => {
    const res = await request(buildApp()).get("/not-found")
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toBe("Task not found")
  })

  it("maps a ValidationError to a 422 and passes through details", async () => {
    const res = await request(buildApp()).get("/validation")
    expect(res.status).toBe(422)
    expect(res.body.errors).toEqual({ field: "title" })
  })

  it("hides an unhandled error behind a generic 500 message (no stack/details leak)", async () => {
    const res = await request(buildApp()).get("/boom")
    expect(res.status).toBe(500)
    expect(res.body.message).toBe("Internal server error")
    expect(JSON.stringify(res.body)).not.toContain("unexpected failure")
  })

  it("echoes the request id used for correlation", async () => {
    const res = await request(buildApp())
      .get("/not-found")
      .set("x-request-id", "test-req-123")
    expect(res.headers["x-request-id"]).toBe("test-req-123")
    expect(res.body.requestId).toBe("test-req-123")
  })
})
