/* =====================================================================
   Your data: export everything, or delete the account. Every table that
   has a userId is included automatically (read from Prisma's schema), so
   a new table can't be forgotten in the export. Deleting the user row
   cascades to all of them (onDelete: Cascade in the schema).
   ===================================================================== */
import { unlink } from "node:fs/promises"
import path from "node:path"
import { Prisma } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import logger from "../../lib/logger.js"
import { UPLOADS_ROOT } from "../../lib/storage.js"
import { NotFoundError } from "../../shared/utils/errors.util.js"

const userTables = (): string[] =>
  Prisma.dmmf.datamodel.models
    .filter((m) => m.name !== "User" && m.fields.some((f) => f.name === "userId" && f.kind === "scalar"))
    .map((m) => m.name)

const delegate = (model: string) =>
  (prisma as unknown as Record<string, { findMany: (args: unknown) => Promise<unknown[]> }>)[model.charAt(0).toLowerCase() + model.slice(1)]

export const exportAccountService = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, timezone: true, createdAt: true },
  })
  if (!user) throw new NotFoundError("User not found")
  const data: Record<string, unknown[]> = {}
  for (const model of userTables()) {
    const d = delegate(model)
    if (d) data[model] = await d.findMany({ where: { userId } })
  }
  return { exportedAt: new Date().toISOString(), user, data }
}

// The file behind a stored /uploads/... link, or null if it points anywhere else.
export const uploadPathOf = (url: string | null | undefined, root: string = UPLOADS_ROOT): string | null => {
  if (!url?.startsWith("/uploads/")) return null
  const file = path.resolve(root, url.slice("/uploads/".length))
  return file.startsWith(path.resolve(root) + path.sep) ? file : null
}

const mediaOf = async (userId: string): Promise<string[]> => {
  const rows = await prisma.capture.findMany({ where: { userId, mediaUrl: { not: null } }, select: { mediaUrl: true } })
  return rows.map((r) => uploadPathOf(r.mediaUrl)).filter((f): f is string => f !== null)
}

// Best-effort: a file already gone is fine, and the data is deleted either way.
const removeFiles = async (files: string[]): Promise<void> => {
  await Promise.all(
    files.map((f) =>
      unlink(f).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") logger.warn(`Could not delete an uploaded file: ${err.message}`)
      }),
    ),
  )
}

export const deleteAccountService = async (userId: string) => {
  const files = await mediaOf(userId)
  const result = await prisma.user.deleteMany({ where: { id: userId } })
  if (result.count === 0) throw new NotFoundError("User not found")
  await removeFiles(files)
}

export const _userTablesForTest = userTables
