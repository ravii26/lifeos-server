import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { env } from "../../config/env.config.js"
import { UnauthorizedError } from "../utils/errors.util.js"
import type { AuthTokenPayload } from "../types/common.types.js"

// Verifies the JWT from the Authorization header and attaches the user
// to req.user. Protects any route it is applied to.
export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith("Bearer ")) throw new UnauthorizedError("No token provided")

  const token = authHeader.split(" ")[1]

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload
    req.user = { id: payload.id, email: payload.email }
    next()
  } catch {
    throw new UnauthorizedError("Invalid or expired token")
  }
}
