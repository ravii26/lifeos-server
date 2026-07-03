import { randomUUID } from "node:crypto"
import type { Request, Response, NextFunction } from "express"

// Threads a correlation ID through the request lifecycle: logs, error
// responses, and anything the client reports back. Honors a client-supplied
// `x-request-id` header (useful when a request is proxied or retried) and
// otherwise mints a fresh UUID.
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.headers["x-request-id"]
  req.id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID()
  res.setHeader("X-Request-Id", req.id)
  next()
}
