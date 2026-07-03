import "express"

// Augments Express's Request type so `req.user` is typed everywhere
// after the authenticate middleware runs — no casting needed. Also carries
// `req.id`, the per-request correlation ID set by requestId.middleware.ts.
declare global {
  namespace Express {
    interface Request {
      id: string
      user?: {
        id: string
        email: string
        language?: string
      }
    }
  }
}
