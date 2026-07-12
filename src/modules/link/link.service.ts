import { Prisma } from "@prisma/client"
import { ConflictError, NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { findTaskById } from "../task/task.repository.js"
import { findGoalById } from "../goal/goal.repository.js"
import { findProjectById } from "../project/project.repository.js"
import { findResourceById } from "../resource/resource.repository.js"
import { findTopicById } from "../topic/topic.repository.js"
import { findNoteById } from "../note/note.repository.js"
import { findHabitById } from "../habit/habit.repository.js"
import { findVaultItemById } from "../vault/vault.repository.js"
import { findDocumentById } from "../document/document.repository.js"
import { createLink, findLinkById, findLinksForEntity, deleteLink } from "./link.repository.js"
import { rollupLinkIfTaskDone } from "./link.rollup.js"
import type { CreateLinkDto, ListLinksDto, EntityTypeValue } from "./link.schema.js"
import type { LinkDto, EnrichedLinkDto } from "./link.dto.js"

// Because EntityLink's from/to ids are polymorphic (not DB foreign keys), the
// service is the ONLY place that guarantees a link points at a real, owned
// entity. This registry maps each EntityType to its owner-scoped finder — every
// EntityType value must appear here, or resolving it throws.
const OWNERSHIP_FINDERS: Record<
  EntityTypeValue,
  (id: string, userId: string) => Promise<unknown | null>
> = {
  TASK: findTaskById,
  GOAL: findGoalById,
  PROJECT: findProjectById,
  RESOURCE: findResourceById,
  TOPIC: findTopicById,
  NOTE: findNoteById,
  HABIT: findHabitById,
  VAULT: findVaultItemById,
  DOCUMENT: findDocumentById,
}

const assertEntityOwned = async (
  userId: string,
  type: EntityTypeValue,
  id: string,
  label: string,
) => {
  const finder = OWNERSHIP_FINDERS[type]
  const entity = await finder(id, userId)
  if (!entity) throw new NotFoundError(`${label} not found`)
}

// Every linkable entity has a `title` column. Resolve it for display; fall back
// gracefully if the row vanished between the link read and this lookup (a link
// can outlive its target — deleting an entity doesn't cascade to EntityLink).
const resolveLabel = async (
  userId: string,
  type: EntityTypeValue,
  id: string,
): Promise<string> => {
  const entity = (await OWNERSHIP_FINDERS[type](id, userId)) as { title?: string } | null
  return entity?.title ?? "(deleted)"
}

export const createLinkService = async (
  userId: string,
  input: CreateLinkDto,
): Promise<LinkDto> => {
  // A weight only means anything on an ADVANCES link (it feeds progress roll-up).
  // Reject it on REFERENCES links rather than silently storing dead data.
  const role = input.role ?? "REFERENCES"
  if (input.weight !== undefined && role !== "ADVANCES") {
    throw new ValidationError("weight is only valid on ADVANCES links")
  }

  // Both endpoints must exist and belong to this user before we persist a link.
  await Promise.all([
    assertEntityOwned(userId, input.fromType, input.fromId, "Link source"),
    assertEntityOwned(userId, input.toType, input.toId, "Link target"),
  ])

  try {
    const link = await createLink({
      userId,
      fromType: input.fromType,
      fromId: input.fromId,
      toType: input.toType,
      toId: input.toId,
      role,
      weight: input.weight ?? null,
    })
    // Linking an ALREADY-completed task to a resource should advance it now —
    // the work is done, the link just makes that contribution explicit.
    await rollupLinkIfTaskDone(userId, link, 1)
    return link
  } catch (err) {
    // Unique constraint — the same directed link with the same role already exists.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("This link already exists")
    }
    throw err
  }
}

export const listLinksService = async (
  userId: string,
  filters: ListLinksDto,
): Promise<EnrichedLinkDto[]> => {
  const links = await findLinksForEntity(userId, filters.type, filters.id, filters.role)
  return Promise.all(
    links.map(async (link) => {
      const [fromLabel, toLabel] = await Promise.all([
        resolveLabel(userId, link.fromType, link.fromId),
        resolveLabel(userId, link.toType, link.toId),
      ])
      return { ...link, fromLabel, toLabel }
    }),
  )
}

export const deleteLinkService = async (id: string, userId: string): Promise<void> => {
  const existing = await findLinkById(id, userId)
  if (!existing) throw new NotFoundError("Link not found")
  // Removing an advancing link from a completed task rolls its contribution back.
  await rollupLinkIfTaskDone(userId, existing, -1)
  await deleteLink(id, userId)
}
