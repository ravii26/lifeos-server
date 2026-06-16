import type { Request, Response, NextFunction } from "express"
import { AppError } from "../utils/errors.util.js"
import { sendError } from "../utils/response.util.js"
import { HttpStatus } from "../constants/httpStatus.js"
import logger from "../../lib/logger.js"

export const errorMiddleware = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    logger.warn(`${err.name}: ${err.message}`)
    return sendError(res, err.message, err.statusCode, err.details)
  }

  logger.error("Unhandled error:", err)
  return sendError(res, "Internal server error", HttpStatus.INTERNAL_SERVER_ERROR)
}
