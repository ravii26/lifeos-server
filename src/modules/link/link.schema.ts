import { z } from "zod"

// Keep in lockstep with the EntityType / LinkRole enums in schema.prisma.
export const entityType = z.enum([
  "TASK",
  "GOAL",
  "PROJECT",
  "RESOURCE",
  "TOPIC",
  "NOTE",
  "HABIT",
  "VAULT",
  "DOCUMENT",
])
const linkRole = z.enum(["ADVANCES", "REFERENCES"])

export const createLinkSchema = z
  .object({
    fromType: entityType,
    fromId: z.string().min(1),
    toType: entityType,
    toId: z.string().min(1),
    role: linkRole.optional(),
    // Roll-up weight for ADVANCES links, e.g. "worth 3 lessons". Omit == 1.
    weight: z.number().int().positive().max(1000).optional(),
  })
  .refine(
    (v) => !(v.fromType === v.toType && v.fromId === v.toId),
    { message: "An entity cannot link to itself", path: ["toId"] },
  )

// List links touching a given entity, in either direction.
export const listLinksSchema = z.object({
  type: entityType,
  id: z.string().min(1),
  role: linkRole.optional(),
})

export type CreateLinkDto = z.infer<typeof createLinkSchema>
export type ListLinksDto = z.infer<typeof listLinksSchema>
export type EntityTypeValue = z.infer<typeof entityType>
