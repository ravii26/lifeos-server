import { Prisma } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { classifyMediaCapture } from "../capture/capture.ai.js"
import { createCapture, findCaptureById, updateCapture } from "../capture/capture.repository.js"
import { createTaskService } from "../task/task.service.js"
import { createHabitService } from "../habit/habit.service.js"
import { createAllyNoteService } from "../allynote/allynote.service.js"
import { createVaultItem } from "../vault/vault.repository.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { todayKeyInTz, dateFromKey, addUtcDays } from "../../shared/utils/time.util.js"
import logger from "../../lib/logger.js"
import {
  extractUrl,
  readLink,
  proposeAction,
  watchVideo,
  platformOf,
  type LinkInfo,
  type SaveAiInput,
  type SaveAction,
  type SavePurposeGuess,
  type SaveProposal,
  type SaveWhen,
} from "./guide.saves.ai.js"
import { setTonightToTaskService } from "./guide.service.js"
import type { DecideSaveDto } from "./guide.schema.js"

// "NONE" = nothing to read (not a video link), "PENDING" = Ally is watching it,
// "READY" = the summary is in, "UNAVAILABLE" = it could not be watched.
export type SummaryState = "NONE" | "PENDING" | "READY" | "UNAVAILABLE"

export interface SaveDto {
  id: string
  url: string | null
  platform: string | null
  author: string | null
  proposal: SaveProposal
  summary: { state: SummaryState; lines: string[] }
  // Feeling saves go straight to the shelf; this says so.
  shelved: boolean
}

export interface SaveInput {
  text?: string
  file?: { buffer: Buffer; mimeType: string }
}

interface Stored {
  kind: "SAVE"
  proposal: SaveProposal
  summary?: { state: SummaryState; lines: string[] }
  purposeBy?: "ai" | "user"
}

type CaptureRow = NonNullable<Awaited<ReturnType<typeof findCaptureById>>>

const MAIN_FIRST = (areas: { id: string; tier: string }[]) => areas.find((a) => a.tier === "MAIN") ?? areas[0] ?? null

// Saves made before step 6 have no purpose or action list: fill them in.
const normalizeProposal = (p: SaveProposal): SaveProposal => {
  const actions: SaveAction[] = p.actions?.length
    ? p.actions
    : [{ action: p.action, minimum: p.minimum, as: "TODO", when: p.when }]
  return { ...p, purpose: p.purpose ?? "LEARN", feelings: p.feelings ?? [], actions }
}

const storedOf = (raw: Prisma.JsonValue | null): Stored | null => {
  const s = (raw as Partial<Stored> | null) ?? null
  return s?.kind === "SAVE" && s.proposal ? { ...(s as Stored), proposal: normalizeProposal(s.proposal) } : null
}

const isShelved = (c: CaptureRow) => (c.createdOutputs as { type?: string } | null)?.type === "VAULT"

const toDto = (c: CaptureRow): SaveDto => {
  const stored = storedOf(c.suggestedOutputs)
  if (!stored) throw new NotFoundError("Save not found")
  const meta = c.urlMetadata as LinkInfo | null
  return {
    id: c.id,
    url: c.detectedUrl,
    platform: meta?.platform ?? null,
    author: meta?.author ?? null,
    proposal: stored.proposal,
    summary: stored.summary ?? { state: "NONE", lines: [] },
    shelved: isShelved(c),
  }
}

const saveStored = (id: string, userId: string, stored: Stored, extra: Prisma.CaptureUpdateInput = {}) =>
  updateCapture(id, userId, { suggestedOutputs: stored as unknown as Prisma.InputJsonValue, ...extra })

// A feeling save waits on the shelf and comes back on that feeling.
const shelve = async (userId: string, captureId: string, proposal: SaveProposal, url: string | null, rawText: string) => {
  const item = await createVaultItem({
    userId,
    title: proposal.contentTitle,
    content: url ?? rawText,
    vaultType: "MOTIVATION",
    mediaType: url ? "VIDEO" : "TEXT",
    url,
    triggerTags: proposal.feelings.length ? proposal.feelings : ["unmotivated"],
  })
  await updateCapture(captureId, userId, {
    status: "CONVERTED",
    createdOutputs: { type: "VAULT", id: item.id } as Prisma.InputJsonValue,
  })
  return item
}

// Reads what was saved (link title, what a screenshot shows, and for a YouTube
// link the video itself, in the background) and drafts what to do with it.
// Nothing is created for a learning save until the person decides.
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

  const proposal = await proposeAction({ text, link, areas, yearGoal: identity?.thisYearGoal ?? null })
  const isVideo = !!url && platformOf(url) === "YouTube"

  const stored: Stored = {
    kind: "SAVE",
    proposal,
    summary: { state: isVideo ? "PENDING" : "NONE", lines: [] },
    purposeBy: "ai",
  }
  const capture = await createCapture({
    userId,
    rawText: text || url || proposal.contentTitle,
    detectedUrl: url,
    urlMetadata: (link ?? undefined) as Prisma.InputJsonValue | undefined,
    mediaType: input.file ? "IMAGE" : "TEXT",
    status: "PENDING",
    purpose: proposal.purpose,
    feelings: proposal.feelings,
    suggestedOutputs: stored as unknown as Prisma.InputJsonValue,
  })
  logBehavior(userId, "CAPTURE_CREATED", { captureId: capture.id, via: "save" })

  if (proposal.purpose === "FEELING") await shelve(userId, capture.id, proposal, url, capture.rawText)
  if (isVideo) void watchInBackground(userId, capture.id, url!, areas, identity?.thisYearGoal ?? null)

  return toDto((await findCaptureById(capture.id, userId))!)
}

// Watches the video and attaches the real summary and sharper actions. If it
// cannot be watched (private, too long, no key) the title-based proposal stays
// and the summary is marked unavailable: Ally never makes a summary up.
const watchInBackground = async (userId: string, id: string, url: string, areas: SaveAiInput["areas"], yearGoal: string | null) => {
  try {
    const read = await watchVideo(url, areas, yearGoal)
    const row = await findCaptureById(id, userId)
    const stored = row ? storedOf(row.suggestedOutputs) : null
    if (!row || !stored) return
    if (!read) {
      await saveStored(id, userId, { ...stored, summary: { state: "UNAVAILABLE", lines: [] } })
      return
    }
    const keepPurpose = stored.purposeBy === "user"
    const purpose: SavePurposeGuess = keepPurpose ? stored.proposal.purpose : read.purpose
    const feelings = purpose === "FEELING" ? (keepPurpose ? stored.proposal.feelings : read.feelings.length ? read.feelings : stored.proposal.feelings) : []
    const actions = purpose === "FEELING" ? read.actions.slice(0, 1) : read.actions
    const proposal: SaveProposal = {
      ...stored.proposal,
      contentTitle: read.title ?? stored.proposal.contentTitle,
      purpose,
      feelings,
      actions,
      action: actions[0]!.action,
      minimum: actions[0]!.minimum,
      when: actions[0]!.when,
      kind: purpose === "FEELING" ? "MOTIVATION" : stored.proposal.kind,
    }
    await saveStored(id, userId, { ...stored, proposal, summary: { state: "READY", lines: read.lines } }, {
      summary: read.lines.join("\n"),
      purpose,
      feelings,
    })
    // The video turned out to be comfort, not a lesson: it goes on the shelf.
    if (purpose === "FEELING" && row.status === "PENDING") await shelve(userId, id, proposal, row.detectedUrl, row.rawText)
  } catch (err) {
    logger.warn(`Background video read failed for save ${id}:`, err)
  }
}

export interface SaveListItem {
  id: string
  title: string
  purpose: SavePurposeGuess
  feelings: string[]
  shelved: boolean
  status: string
  url: string | null
  platform: string | null
  hasSummary: boolean
  createdAt: Date
}

// What the person has saved: waiting for a decision, or kept on the shelf.
// Saves that became actions or were let go are history, not a list to tend.
export const listSavesService = async (userId: string): Promise<SaveListItem[]> => {
  const rows = await prisma.capture.findMany({
    where: { userId, status: { in: ["PENDING", "CONVERTED"] }, suggestedOutputs: { path: ["kind"], equals: "SAVE" } },
    orderBy: { createdAt: "desc" },
    take: 60,
  })
  return rows
    .filter((c) => c.status === "PENDING" || isShelved(c))
    .map((c) => {
      const stored = storedOf(c.suggestedOutputs)!
      const meta = c.urlMetadata as LinkInfo | null
      return {
        id: c.id,
        title: stored.proposal.contentTitle,
        purpose: stored.proposal.purpose,
        feelings: stored.proposal.feelings,
        shelved: isShelved(c),
        status: c.status,
        url: c.detectedUrl,
        platform: meta?.platform ?? null,
        hasSummary: stored.summary?.state === "READY",
        createdAt: c.createdAt,
      }
    })
}

export const getSaveService = async (userId: string, id: string): Promise<SaveDto> => {
  const capture = await findCaptureById(id, userId)
  if (!capture) throw new NotFoundError("Save not found")
  return toDto(capture)
}

// One tap to correct Ally's guess: learning ↔ feeling.
export const setSavePurposeService = async (userId: string, id: string, purpose: SavePurposeGuess): Promise<SaveDto> => {
  const capture = await findCaptureById(id, userId)
  if (!capture) throw new NotFoundError("Save not found")
  const stored = storedOf(capture.suggestedOutputs)
  if (!stored) throw new NotFoundError("Save not found")
  if (stored.proposal.purpose === purpose) return toDto(capture)
  if (capture.status === "CONVERTED" && !isShelved(capture)) throw new ValidationError("This save already became an action")
  if (capture.status === "DISMISSED") throw new ValidationError("This save was let go")

  const [areas, identity] = await Promise.all([
    prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true, tier: true } }),
    prisma.identity.findUnique({ where: { userId }, select: { thisYearGoal: true } }),
  ])
  const proposal = await proposeAction({
    text: capture.rawText,
    link: (capture.urlMetadata as LinkInfo | null) ?? null,
    areas,
    yearGoal: identity?.thisYearGoal ?? null,
    forcePurpose: purpose,
  })
  // Keep the better title when the video was actually watched.
  const merged: SaveProposal = {
    ...proposal,
    contentTitle: stored.summary?.state === "READY" ? stored.proposal.contentTitle : proposal.contentTitle,
  }

  if (purpose === "LEARN") {
    // Off the shelf (the item was made from this save), back to deciding.
    const out = capture.createdOutputs as { type?: string; id?: string } | null
    if (out?.type === "VAULT" && out.id) await prisma.vaultItem.deleteMany({ where: { id: out.id, userId } })
    await updateCapture(id, userId, { status: "PENDING", createdOutputs: Prisma.JsonNull, purpose, feelings: [] })
    await saveStored(id, userId, { ...stored, proposal: merged, purposeBy: "user" })
  } else {
    await updateCapture(id, userId, { purpose, feelings: merged.feelings })
    await saveStored(id, userId, { ...stored, proposal: merged, purposeBy: "user" })
    if (capture.status === "PENDING") await shelve(userId, id, merged, capture.detectedUrl, capture.rawText)
  }
  return toDto((await findCaptureById(id, userId))!)
}

const dueFor = (when: SaveWhen, timeZone: string): Date => {
  const today = dateFromKey(todayKeyInTz(timeZone))
  return when === "TONIGHT" ? today : addUtcDays(today, when === "THIS_WEEK" ? 3 : 21)
}

export interface DecideResult {
  choice: DecideSaveDto["choice"]
  taskId: string | null
  taskIds: string[]
  habitIds: string[]
  vaultItemId: string | null
  noteId: string | null
  // True when the action became tonight's one thing.
  setAsTonight: boolean
}

export const decideSaveService = async (userId: string, id: string, input: DecideSaveDto): Promise<DecideResult> => {
  const capture = await findCaptureById(id, userId)
  if (!capture) throw new NotFoundError("Save not found")
  // A feeling save is shelved the moment it is read, so choosing the shelf again is a no-op.
  const shelvedId = (capture.createdOutputs as { type?: string; id?: string } | null)?.id
  if (input.choice === "SHELF" && isShelved(capture) && shelvedId) {
    return { choice: "SHELF", taskId: null, taskIds: [], habitIds: [], vaultItemId: shelvedId, noteId: null, setAsTonight: false }
  }
  // Choosing a step, or letting it go, for a save Ally had shelved means the
  // guess was wrong: take it off the shelf first, then carry on.
  if (isShelved(capture) && input.choice !== "SHELF") {
    if (shelvedId) await prisma.vaultItem.deleteMany({ where: { id: shelvedId, userId } })
    await updateCapture(id, userId, { status: "PENDING", createdOutputs: Prisma.JsonNull })
    return decideSaveService(userId, id, input)
  }
  if (capture.status !== "PENDING") throw new ValidationError("This save was already decided")
  const stored = storedOf(capture.suggestedOutputs)
  const proposal = stored?.proposal ?? null
  const contentTitle = proposal?.contentTitle ?? capture.rawText.slice(0, 120)
  const url = capture.detectedUrl
  const empty = { taskId: null, taskIds: [] as string[], habitIds: [] as string[], vaultItemId: null, noteId: null, setAsTonight: false }

  if (input.choice === "DROP") {
    await updateCapture(id, userId, { status: "DISMISSED" })
    return { choice: "DROP", ...empty }
  }

  if (input.choice === "SHELF") {
    const item = await shelve(userId, id, proposal ?? ({ contentTitle, feelings: [] } as unknown as SaveProposal), url, capture.rawText)
    return { choice: "SHELF", ...empty, vaultItemId: item.id }
  }

  // One or several steps, each a to-do or a habit. A single `action` still works.
  const picked: { action: string; minimum?: string; as: "TODO" | "HABIT"; when: SaveWhen; areaId?: string }[] = input.actions?.length
    ? input.actions.map((a) => ({ action: a.action, minimum: a.minimum, as: a.as ?? "TODO", when: a.when ?? proposal?.when ?? "THIS_WEEK", areaId: a.areaId }))
    : [
        {
          action: input.action?.trim() || proposal?.action || "",
          minimum: input.minimum?.trim() || proposal?.minimum,
          as: "TODO" as const,
          when: input.when ?? proposal?.when ?? "THIS_WEEK",
          areaId: input.areaId,
        },
      ]
  if (!picked.some((a) => a.action.trim())) throw new ValidationError("An action is required")

  const [user, areas] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, tier: true } }),
  ])
  const tz = user?.timezone ?? "Asia/Kolkata"
  const taskIds: string[] = []
  const habitIds: string[] = []
  let tonightTaskId: string | null = null
  for (const a of picked.filter((p) => p.action.trim()).slice(0, 3)) {
    const areaId = a.areaId ?? proposal?.areaId ?? MAIN_FIRST(areas)?.id
    if (a.as === "HABIT" && areaId) {
      const habit = await createHabitService(userId, { title: a.action.trim().slice(0, 200), areaId, minimumVersion: a.minimum?.trim() || undefined }, { source: "SHARE" })
      habitIds.push(habit.id)
      continue
    }
    const task = await createTaskService(
      userId,
      {
        title: a.action.trim().slice(0, 200),
        description: [`From your save: ${contentTitle}`, url].filter(Boolean).join("\n"),
        minimumVersion: a.minimum?.trim() || undefined,
        areaId: a.areaId ?? proposal?.areaId ?? undefined,
        priority: a.when === "TONIGHT" ? "HIGH" : "MEDIUM",
        dueDate: dueFor(a.when, tz),
        source: "DUMP",
        sourceId: id,
      },
      { source: "SHARE" },
    )
    taskIds.push(task.id)
    if (a.when === "TONIGHT" && !tonightTaskId) tonightTaskId = task.id
  }
  if (!taskIds.length && !habitIds.length) throw new ValidationError("An action is required")

  // What the video said is worth keeping even after the steps are made.
  let noteId: string | null = null
  const lines = stored?.summary?.state === "READY" ? stored.summary.lines : []
  if (lines.length) {
    const note = await createAllyNoteService(
      userId,
      { collection: "Saves", template: "INFO", title: contentTitle, items: lines, text: url },
      { source: "SHARE" },
    )
    noteId = note.id
  }

  await updateCapture(id, userId, {
    status: "CONVERTED",
    createdOutputs: { type: taskIds.length ? "TASK" : "HABIT", id: taskIds[0] ?? habitIds[0], taskIds, habitIds, noteId } as Prisma.InputJsonValue,
  })
  const setAsTonight = tonightTaskId ? await setTonightToTaskService(userId, tonightTaskId) : false
  return { choice: "ACTION", taskId: taskIds[0] ?? null, taskIds, habitIds, vaultItemId: null, noteId, setAsTonight }
}
