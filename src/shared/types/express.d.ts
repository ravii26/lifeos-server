import "express"

// Augments Express's Request type so `req.user` is typed everywhere
// after the authenticate middleware runs — no casting needed.
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        language?: string
      }
    }
  }
}
