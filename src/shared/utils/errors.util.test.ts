import { describe, expect, it } from "vitest"
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./errors.util.js"

describe("AppError subclasses", () => {
  it("AppError defaults to 500 with no details", () => {
    const err = new AppError("boom")
    expect(err.statusCode).toBe(500)
    expect(err.details).toBeUndefined()
    expect(err.name).toBe("AppError")
    expect(err).toBeInstanceOf(Error)
  })

  it.each([
    [NotFoundError, 404, "Resource not found"],
    [UnauthorizedError, 401, "Unauthorized"],
    [ForbiddenError, 403, "Forbidden"],
    [ConflictError, 409, "Conflict"],
    [ValidationError, 422, "Validation failed"],
  ] as const)("%s uses statusCode %i and the default message", (Ctor, statusCode, defaultMessage) => {
    const err = new Ctor()
    expect(err.statusCode).toBe(statusCode)
    expect(err.message).toBe(defaultMessage)
    expect(err).toBeInstanceOf(AppError)
  })

  it("accepts a custom message and preserves it", () => {
    const err = new NotFoundError("Task not found")
    expect(err.message).toBe("Task not found")
    expect(err.statusCode).toBe(404)
  })

  it("ConflictError and ValidationError carry optional details", () => {
    const details = { field: "email" }
    expect(new ConflictError("dup", details).details).toEqual(details)
    expect(new ValidationError("bad", details).details).toEqual(details)
  })
})
