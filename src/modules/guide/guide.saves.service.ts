import type { Prisma } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { classifyMediaCapture } from "../capture/capture.ai.js"
import { createCapture, findCaptureById, updateCapture } from "../capture/capture.repository.js"
import { createTaskService } from "../task/task.service.js"
import { createVaultItem } from "../vault/vault.repository.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { todayKeyInTz, dateFromKey, addUtcDays } from "../../shared/utils/time.util.js"
import {
  extractUrl,
  readLink,
  proposeAction,
  type LinkInfo,
  type SaveProposal,
  type SaveWhen,
} from "./guide.saves.ai.js"
import { setTonightToTaskService } from "./guide.service.js"
import type { DecideSaveDto } from "./guide.schema.js"

export interface SaveDto {
  id: string
  url: string | null
  platform: string | null
  author: string | null
  proposal: SaveProposal
}

export interface SaveInput {
  text?: string
  file?: { buffer: Buffer; mimeType: string }
}

const proposalOf = (raw: Prisma.JsonValue | null): SaveProposal | null => {
  const p = (raw as { kind?: string; proposal?: SaveProposal } | null) ?? null
  return p?.kind === "SAVE" && p.proposal ? p.proposal : null
}

// Reads what was saved (link title, or what a screenshot shows) and drafts
// one action for it. Nothing is created yet: the person decides.
export const createSaveService = async (userId: string, input: SaveInput): Promise<SaveDto> => {
  let text = input.text?.trim() ?? ""
  if (!text && !input.file) throw new ValidationError("Share a link, some text, or a screenshot")

  const url = extractUrl(text)
  const [link, areas, identity, described] = await Promise.all([
    url ? readLink(url) : Promise.resolve<LinkInfo | null>(null),
    prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true, tier: true } }),
    prisma.identity.findUnique({ where: { userId }, select: { thisYearGoal: true } }),
    input.file
      ? classifyMediaCapture(input.file.buffer, input.file.mimeType, text || undefined)
          .then((c) => c.transcript ?? null)
          .catch(() => null)
      : Promise.resolve<string | null>(null),
  ])
  if (described) text = text ? `${text}\n${described}` : described

  const proposal = await proposeAction({
    text,
    link,
    areas,
    yearGoal: identity?.thisYearGoal ?? null,
  })

  const capture = await createCapture({
    userId,
    rawText: text || url || proposal.contentTitle,
    detectedUrl: url,
    urlMetadata: (link ?? undefined) as Prisma.InputJsonValue | undefined,
    mediaType: input.file ? "IMAGE" : "TEXT",
    status: "PENDING",
    suggestedOutputs: { kind: "SAVE", proposal } as unknown as Prisma.InputJsonValue,
  })
  logBehavior(userId, "CAPTURE_CREATED", { captureId: capture.id, via: "save" })

  return {
    id: capture.id,
    url,
    platform: link?.platform ?? null,
    author: link?.author ?? null,
    proposal,
  }
}

const dueFor = (when: SaveWhen, timeZone: string): Date => {
  const today = dateFromKey(todayKeyInTz(timeZone))
  return when === "TONIGHT" ? today : addUtcDays(today, when === "THIS_WEEK" ? 3 : 21)
}

export interface DecideResult {
  choice: DecideSaveDto["choice"]
  taskId: string | null
  vaultItemId: string | null
  // True when the action became tonight's one thing.
  setAsTonight: boolean
}

export const decideSaveService = async (
  userId: string,
  id: string,
  input: DecideSaveDto,
): Promise<DecideResult> => {
  const capture = await findCaptureById(id, userId)
  if (!capture) throw new NotFoundError("Save not found")
  if (capture.status !== "PENDING") throw new ValidationError("This save was already decided")
  const proposal = proposalOf(capture.suggestedOutputs)
  const contentTitle = proposal?.contentTitle ?? capture.rawText.slice(0, 120)
  const url = capture.detectedUrl

  if (input.choice === "DROP") {
    await updateCapture(id, userId, { status: "DISMISSED" })
    return { choice: "DROP", taskId: null, vaultItemId: null, setAsTonight: false }
  }

  if (input.choice === "SHELF") {
    const item = await createVaultItem({
      userId,
      title: contentTitle,
      content: url ?? capture.rawText,
      vaultType: "MOTIVATION",
      mediaType: url ? "VIDEO" : "TEXT",
      url,
      triggerTags: ["hard-day"],
    })
    await updateCapture(id, userId, {
      status: "CONVERTED",
      createdOutputs: { type: "VAULT", id: item.id } as Prisma.InputJsonValue,
    })
    return { choice: "SHELF", taskId: null, vaultItemId: item.id, setAsTonight: false }
  }

  const title = input.action?.trim() || proposal?.action
  if (!title) throw new ValidationError("An action is required")
  const when = input.when ?? proposal?.when ?? "THIS_WEEK"
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } })

  const task = await createTaskService(userId, {
    title,
    description: [`From your save: ${contentTitle}`, url].filter(Boolean).join("\n"),
    minimumVersion: input.minimum?.trim() || proposal?.minimum,
    areaId: input.areaId ?? proposal?.areaId ?? undefined,
    priority: when === "TONIGHT" ? "HIGH" : "MEDIUM",
    dueDate: dueFor(when, user?.timezone ?? "Asia/Kolkata"),
    source: "DUMP",
    sourceId: id,
  })
  await updateCapture(id, userId, {
    status: "CONVERTED",
    createdOutputs: { type: "TASK", id: task.id } as Prisma.InputJsonValue,
  })

  const setAsTonight = when === "TONIGHT" ? await setTonightToTaskService(userId, task.id) : false
  return { choice: "ACTION", taskId: task.id, vaultItemId: null, setAsTonight }
}
