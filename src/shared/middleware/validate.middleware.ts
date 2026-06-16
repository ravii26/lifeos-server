import type { Request, Response, NextFunction } from "express"
import type { ZodType } from "zod"
import { ValidationError } from "../utils/errors.util.js"

// Reusable validation middleware. Pass a Zod schema and it validates
// req.body before the controller runs. On success, req.body is replaced
// with the parsed (and typed) data. On failure, it throws ValidationError.
export const validate = (schema: ZodType) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      throw new ValidationError("Validation failed", result.error.flatten().fieldErrors)
    }
    req.body = result.data
    next()
  }
}

// Validates req.query. Express 5 makes req.query read-only, so the parsed
// result is stored on res.locals.query for the controller to read.
export const validateQuery = (schema: ZodType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      throw new ValidationError("Validation failed", result.error.flatten().fieldErrors)
    }
    res.locals.query = result.data
    next()
  }
}
