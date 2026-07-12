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

// Document upload (Library module). Plain-text formats only — the body is read
// as UTF-8 and chunked. PDFs are intentionally out of scope for now. Some
// clients send .md as application/octet-stream, so we also accept by extension.
const DOC_MAX_BYTES = 5 * 1024 * 1024 // 5MB of text is a very large document

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOC_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const okMime = /^text\//i.test(file.mimetype) || file.mimetype === "application/octet-stream"
    const okExt = /\.(txt|md|markdown|text)$/i.test(file.originalname || "")
    if (okMime || okExt) {
      cb(null, true)
    } else {
      cb(new ValidationError("Only .txt or .md text files are allowed"))
    }
  },
})

// Accepts an optional single "file" field for a pasted-or-uploaded document.
// Non-multipart requests (JSON paste) pass straight through.
export const uploadDocumentFile = (req: Request, res: Response, next: NextFunction) => {
  docUpload.single("file")(req, res, (err: unknown) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? "File too large (max 5MB)"
          : `Upload failed: ${err.message}`
      return next(new ValidationError(msg))
    }
    next(err)
  })
}
