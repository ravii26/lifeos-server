/* =====================================================================
   What goes into a chat message's context (ADR 0044). Not the whole life:
   the to-dos and notes this message is about, plus what is due now. Pure
   rules, so they are tested without a database. When something is not
   shown, Ally can still find it with SEARCH, and the context says how many
   to-dos exist, so it never assumes a missing one is not there.
   ===================================================================== */
import { tokenize } from "../search/search.rules.js"

// "what's on my list", "show my to-dos", "plan my week": the whole list is the point.
const WANTS_ALL_TASKS =
  /\b(?:all|every|list|show|pending|left|overdue)\b[^.?!]*\b(?:tasks?|to-?dos?|things)\b|\bmy (?:tasks|to-?dos|list|plan|day|week)\b|\bplan (?:my|the) (?:day|week|weekend)\b|\bwhat(?:'s| is| do i have)\b[^.?!]*\b(?:today|tomorrow|this week|on my plate)\b/i

// "what do you know about me", "forget that": the full memory list is the point.
const ASKS_ABOUT_MEMORY = /\bwhat (?:do|did) you (?:know|remember)\b|\babout me\b|\bforget\b|\bremember (?:when|that i)\b/i

export const wantsAllTasks = (message: string): boolean => WANTS_ALL_TASKS.test(message)
export const asksAboutMemory = (message: string): boolean => ASKS_ABOUT_MEMORY.test(message)

// Fewer memories than before: the daily profile carries the big picture.
export const MEMORIES_PER_MESSAGE = 12
export const MEMORIES_WHEN_ASKED = 30
export const memoryLimitFor = (message: string): number => (asksAboutMemory(message) ? MEMORIES_WHEN_ASKED : MEMORIES_PER_MESSAGE)

export const TASKS_PER_MESSAGE = 15
export const NOTES_PER_MESSAGE = 8

export interface TaskLike {
  id: string
  title: string
  dueDate: Date | null
}

// The to-dos worth showing for this message: ones it is about (by meaning, from
// the life index, or by shared words), then ones due by tomorrow. Asking about
// the list itself shows the whole list.
export const pickTasksForPrompt = <T extends TaskLike>(tasks: T[], message: string, tomorrowKey: string, related: Set<string>, limit = TASKS_PER_MESSAGE): T[] => {
  if (wantsAllTasks(message)) return tasks
  const q = new Set(tokenize(message))
  return tasks
    .map((t, order) => {
      const overlap = tokenize(t.title).filter((w) => q.has(w)).length
      const dueSoon = t.dueDate !== null && t.dueDate.toISOString().slice(0, 10) <= tomorrowKey
      const score = (related.has(t.id) ? 4 : 0) + overlap * 3 + (dueSoon ? 1 : 0)
      return { t, score, order }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.t)
}

// Notes this message is about: by shared words (already ranked by the caller) and by meaning.
export const pickNotes = <T extends { id: string }>(byWords: T[], all: T[], related: Set<string>, limit = NOTES_PER_MESSAGE): T[] => {
  const chosen = new Map<string, T>()
  for (const n of all) if (related.has(n.id) && chosen.size < limit) chosen.set(n.id, n)
  for (const n of byWords) if (!chosen.has(n.id) && chosen.size < limit) chosen.set(n.id, n)
  return [...chosen.values()]
}
