/* =====================================================================
   Your data: export everything, or delete the account. Every table that
   has a userId is included automatically (read from Prisma's schema), so
   a new table can't be forgotten in the export. Deleting the user row
   cascades to all of them (onDelete: Cascade in the schema).
   ===================================================================== */
import { Prisma } from "@prisma/client"
import prisma from "../../lib/prisma.js"
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

export const deleteAccountService = async (userId: string) => {
  const result = await prisma.user.deleteMany({ where: { id: userId } })
  if (result.count === 0) throw new NotFoundError("User not found")
}

export const _userTablesForTest = userTables
