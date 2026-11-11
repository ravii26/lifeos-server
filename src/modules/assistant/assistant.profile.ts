/* =====================================================================
   The daily profile (ADR 0044). Instead of sending 25 raw memories with
   every chat message, Ally keeps one short profile of the person, rewritten
   at most once a day from their memories, goals and patterns (the
   "reflection" step from agent research). Every chat sends the profile plus
   a few memories that match the message: the big picture for a few hundred
   tokens, and the same text all day, so the provider's prompt cache keeps
   hitting.

   - Written in the background after a chat, never on the person's time.
   - Private memories (health, mental health) are never put in it.
   - If the AI is down or the day's AI is used up, yesterday's profile stays.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import logger from "../../lib/logger.js"
import { localDayStartMs, todayKeyInTz } from "../../shared/utils/time.util.js"
import { currentMemoryWhere } from "./assistant.memory.rules.js"

export const PROFILE_MAX_CHARS = 900
// Below this there is not enough to say anything a memory list would not.
const MIN_MEMORIES = 6
const MAX_INPUT_MEMORIES = 80

const PROMPT = `You keep a short profile of one person, for their personal assistant to read before every conversation.
Write it from the facts below. Plain sentences, third person, at most 120 words, in this order:
who they are and their situation; what they are working towards now; what gets in their way; what helps them; the people who matter.
Only what the facts say: no guesses, no advice, no praise, no health details. Prefer recent facts when two disagree.
Reply as JSON: {"profile": "..."}`

// Pure: is the stored profile from before the start of today, where the person lives?
export const profileIsStale = (profileAt: Date | null | undefined, timeZone: string, now: Date = new Date()): boolean =>
  !profileAt || profileAt.getTime() < localDayStartMs(todayKeyInTz(timeZone, now), timeZone)

export interface ProfileFacts {
  memories: { content: string; kind: string; importance: number; createdAt: Date }[]
  goals: string[]
  areas: string[]
  habits: string[]
}

// Pure: the facts the profile is written from, most important and newest first.
export const profileInput = (f: ProfileFacts): string => {
  const memories = [...f.memories]
    .sort((a, b) => b.importance - a.importance || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, MAX_INPUT_MEMORIES)
    .map((m) => `- [${m.kind.toLowerCase()}, ${m.createdAt.toISOString().slice(0, 10)}] ${m.content}`)
  return [
    `Facts they told or showed:\n${memories.join("\n")}`,
    f.goals.length ? `Goals now: ${f.goals.join("; ")}` : "",
    f.areas.length ? `Parts of life: ${f.areas.join(", ")}` : "",
    f.habits.length ? `Habits: ${f.habits.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}

// Pure: a usable profile from the model's reply, or null.
export const cleanProfile = (raw: string | null | undefined): string | null => {
  if (!raw) return null
  let text: unknown = raw
  try {
    text = (JSON.parse(raw) as { profile?: unknown }).profile
  } catch {
    // Not JSON: take the text as it is.
  }
  if (typeof text !== "string") return null
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length < 40) return null
  return t.length > PROFILE_MAX_CHARS ? `${t.slice(0, PROFILE_MAX_CHARS - 1).replace(/\s\S*$/, "")}…` : t
}

const writeProfile = (input: string): Promise<string | null> =>
  runWithAiFallback<string | null>(
    "Daily profile",
    {
      groq: groqClient
        ? async () => {
            const res = await groqClient!.chat.completions.create({
              messages: [
                { role: "system", content: PROMPT },
                { role: "user", content: input },
              ],
              model: "openai/gpt-oss-120b",
              response_format: { type: "json_object" },
              max_tokens: 400,
            })
            const out = cleanProfile(res.choices[0]?.message?.content)
            if (!out) throw new Error("no usable profile")
            return out
          }
        : undefined,
      gemini: geminiClient
        ? async () => {
            const model = geminiClient!.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json", maxOutputTokens: 400 } })
            const out = cleanProfile((await model.generateContent([{ text: PROMPT }, { text: input }])).response.text())
            if (!out) throw new Error("no usable profile")
            return out
          }
        : undefined,
    },
    () => null,
  )

// A memory ended, was forgotten or went private, so today's profile may repeat
// it. Dropped at once (chat works without one) and rewritten on the next message.
export const clearProfile = async (userId: string): Promise<void> => {
  await prisma.userSettings.updateMany({ where: { userId }, data: { profile: null, profileAt: null } }).catch((err) => logger.warn(`profile not cleared: ${(err as Error).message}`))
}

// Rewrites the profile when it is from an earlier day. Safe to call after every
// chat: it returns at once when there is nothing to do, and runs one at a time per person.
const running = new Set<string>()
export const refreshProfileIfStale = async (userId: string): Promise<void> => {
  if (running.has(userId)) return
  running.add(userId)
  try {
    const [user, settings] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
      prisma.userSettings.findUnique({ where: { userId }, select: { profileAt: true } }),
    ])
    if (!profileIsStale(settings?.profileAt, user?.timezone ?? "Asia/Kolkata")) return
    const [memories, projects, areas, habits] = await Promise.all([
      prisma.memory.findMany({ where: { userId, sensitive: false, ...currentMemoryWhere() }, orderBy: { createdAt: "desc" }, take: 300, select: { content: true, kind: true, importance: true, createdAt: true } }),
      prisma.project.findMany({ where: { userId, status: "ACTIVE" }, take: 10, select: { title: true } }),
      prisma.area.findMany({ where: { userId, isActive: true }, select: { name: true } }),
      prisma.habit.findMany({ where: { userId, isActive: true }, take: 15, select: { title: true } }),
    ])
    if (memories.length < MIN_MEMORIES) return
    const profile = await writeProfile(
      profileInput({ memories, goals: projects.map((p) => p.title), areas: areas.map((a) => a.name), habits: habits.map((h) => h.title) }),
    )
    if (!profile) return
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, profile, profileAt: new Date() },
      update: { profile, profileAt: new Date() },
    })
  } catch (err) {
    logger.warn(`profile refresh skipped: ${(err as Error).message}`)
  } finally {
    running.delete(userId)
  }
}
