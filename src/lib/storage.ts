import { randomUUID } from "crypto"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import logger from "./logger.js"

/**
 * Media storage abstraction.
 *
 * Today this writes to local disk (served by Express at /uploads). When we move
 * to cloud object storage (Cloudflare R2 / S3 / Spaces), implement a new driver
 * with the same `StorageDriver` interface and swap the exported `storage` — no
 * caller changes needed.
 */

export interface StoredFile {
  /** Storage key/path relative to the bucket or uploads root. */
  key: string
  /** Public URL path (relative to the server origin), e.g. /uploads/captures/<id>.webm */
  url: string
}

export interface SaveOptions {
  /** File extension without the dot, e.g. "webm", "png". */
  ext: string
  /** Logical sub-folder, e.g. "captures". */
  subdir?: string
}

export interface StorageDriver {
  save(buffer: Buffer, opts: SaveOptions): Promise<StoredFile>
}

// ── Local disk driver ────────────────────────────────────────────────────────

/** Absolute path to the uploads root on disk. Served statically by app.ts. */
export const UPLOADS_ROOT = path.join(process.cwd(), "uploads")

class LocalDiskStorage implements StorageDriver {
  async save(buffer: Buffer, opts: SaveOptions): Promise<StoredFile> {
    const subdir = opts.subdir ?? "misc"
    const filename = `${randomUUID()}.${opts.ext}`
    const dir = path.join(UPLOADS_ROOT, subdir)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, filename), buffer)

    const url = `/uploads/${subdir}/${filename}`
    logger.debug(`Stored media at ${url} (${buffer.length} bytes)`)
    return { key: `${subdir}/${filename}`, url }
  }
}

export const storage: StorageDriver = new LocalDiskStorage()

// ── Helpers ──────────────────────────────────────────────────────────────────

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/m4a": "m4a",
}

/** Best-effort file extension from a mime type. */
export const extFromMime = (mime: string): string => MIME_EXT[mime.toLowerCase()] ?? "bin"
