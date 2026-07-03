import multer from "multer"
import type { Request, Response, NextFunction } from "express"
import { ValidationError } from "../utils/errors.util.js"

// Capture media upload. Memory storage so the controller gets a Buffer it can
// BOTH persist (via the storage driver) AND forward to the multimodal AI in the
// same request — no temp-file round trip.
const MAX_BYTES = 25 * 1024 * 1024 // 25MB — covers a few minutes of voice + photos

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (/^(image|audio)\//i.test(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new ValidationError("Only image or audio files are allowed"))
    }
  },
})

// Accepts an optional single "file" field. Non-multipart requests (plain JSON
// text captures) pass straight through untouched. Multer errors (e.g. file too
// large) are normalised into our ValidationError so the error middleware
// responds with a clean 400.
export const uploadCaptureMedia = (req: Request, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? "File too large (max 25MB)"
          : `Upload failed: ${err.message}`
      return next(new ValidationError(msg))
    }
    next(err)
  })
}
