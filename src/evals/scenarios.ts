/* =====================================================================
   Ally scenario evals: real conversations against the real AI, checked
   against what the plan (product-design/12-final-plan.md §6) says must
   happen. Run with `npm run evals` before every release.

   A scenario is "ready" once the feature it tests is built; until then it
   is listed as pending with the build step that delivers it, so the report
   always shows how much of the plan is covered.
   ===================================================================== */

export interface Turn {
  message: string
}

export interface ChatReplyShape {
  role: string
  reply: string
  actions: {
    type: string
    id?: string
    activityId?: string
    time?: string | null
    kind?: string
    remindAt?: string
    windowEnd?: string
    repeatRule?: string
    title?: string
    text?: string
    itemType?: string
    detail?: string
    priority?: string
    deadline?: string
    tasks?: number
    items?: string[]
    feeling?: string
    item?: { id: string; title: string; url: string | null } | null
    step?: string | null
    collection?: string
    template?: string
    notes?: { id: string; title: string; collection: string }[]
    results?: { kind: string; id: string; title: string; snippet: string }[]
    options?: { id: string; title: string; command?: boolean; detail?: string; kind?: string }[]
    total?: number
    proposal?: any
    until?: string | null
  }[]
  suggestions?: { kind: string; title: string }[]
  capacity?: { message: string; plannedMinutes: number; freeMinutes: number; keep: { id: string; title: string }[]; move: { id: string; title: string }[] }
  usedAi: boolean
}

import type { PrismaClient } from "@prisma/client"

export interface ScenarioContext {
  // For checks the API cannot do (e.g. backdating activity to simulate days away).
  db: PrismaClient
  userId: string
  // Logs the same person in again, as if on a new phone.
  newDevice: () => Promise<ScenarioContext["api"]>
  // Fresh per scenario: an empty account with one MAIN area (Career).
  say: (message: string) => Promise<ChatReplyShape>
  api: (method: "get" | "post" | "patch" | "put", path: string, body?: unknown) => Promise<{ status: number; body: any }>
}

export interface Scenario {
  id: string
  name: string
  // Build step that delivers it; "ready" when testable today.
  status: "ready" | { pendingUntil: number }
  run?: (ctx: ScenarioContext) => Promise<string | null> // null = pass, string = why it failed
}

const has = (r: ChatReplyShape, type: string) => r.actions.some((a) => a.type === type)
const questions = (t: string) => (t.match(/\?/g) ?? []).length
const ofType = (r: ChatReplyShape, type: string) => r.actions.filter((a) => a.type === type)
const IST = "Asia/Kolkata"
const hourIst = (iso: string) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", hour12: false }).format(new Date(iso))) % 24
const weekdayIst = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: IST, weekday: "long" }).format(new Date(iso))
const dayKey = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date(Date.now() + offsetDays * 86_400_000))
// The next Wednesday (today if it is one): a weekday where 11:00 is office hours.
const nextWednesday = () => {
  for (let i = 0; i < 7; i++) {
    const k = dayKey(i)
    if (weekdayIst(`${k}T12:00:00+05:30`) === "Wednesday") return k
  }
  return dayKey()
}
const nowAt = (api: ScenarioContext["api"], at: string, minutes?: number) =>
  api("get", `/now?at=${at}${minutes ? `&minutes=${minutes}` : ""}`).then((r) => r.body.data)
const careerId = async (api: ScenarioContext["api"]) => ((await api("get", "/areas")).body.data as any[])[0].id as string
const ago = (days: number) => new Date(Date.now() - days * 86_400_000)
const taskList = async (api: ScenarioContext["api"]) => ((await api("get", "/tasks")).body.data ?? []) as any[]

// Words from the founder's own life. Someone else must never get them back unless they said them first.
const FOUNDER_WORDS = /\b(DSA|leetcode|system design|interviews?|gym|reels?)\b/gi
const founderBias = async (api: ScenarioContext["api"], replies: ChatReplyShape[], said: string): Promise<string | null> => {
  const [tasks, habits, projects] = await Promise.all(["/tasks", "/habits", "/projects"].map((p) => api("get", p).then((r) => r.body.data ?? [])))
  const blob = JSON.stringify([replies, tasks.map((t: any) => t.title), habits.map((h: any) => h.title), projects.map((p: any) => p.title)])
  const heard = said.toLowerCase()
  const leaked = [...blob.matchAll(FOUNDER_WORDS)].map((m) => m[0].toLowerCase()).filter((w) => !heard.includes(w))
  return leaked.length ? `suggested things from someone else's life: ${[...new Set(leaked)].join(", ")}` : null
}

export const scenarios: Scenario[] = [
  {
    id: "F1",
    name: "Voice ramble → habit + breakfast note + prep habit, confirm card",
    status: "ready",
    async run({ say }) {
      const r = await say(
        "I want to drink warm water every morning, and here are my breakfasts: poha, oats, eggs; prep the night before",
      )
      const habits = ofType(r, "HABIT_ADDED")
      const notes = ofType(r, "NOTE_ADDED")
      if (!habits.some((h) => /water/i.test(h.title ?? ""))) return "no warm-water habit"
      if (!habits.some((h) => /prep/i.test(h.title ?? ""))) return `no prep habit; habits: ${habits.map((h: any) => `${h.title}${h.prep ? " [prep: " + h.prep + "]" : ""}`).join(" | ")}`
      const note = notes.find((n) => /breakfast/i.test(n.title ?? ""))
      if (!note) return "no Breakfast note"
      if ((note.items?.length ?? 0) !== 3) return `breakfast note has ${note.items?.length} items, expected 3`
      const made = habits.length + notes.length
      if (made !== 3) return `${made} things saved, expected 3`
      if (r.actions.some((a) => !a.activityId && ["HABIT_ADDED", "NOTE_ADDED"].includes(a.type))) return "something has no undo"
      return null
    },
  },
  {
    id: "F2",
    name: '"What can I eat?" answered from the Breakfast note',
    status: "ready",
    async run({ say }) {
      // No note yet: ask once, never invent.
      const none = await say("what can I eat for breakfast?")
      if (ofType(none, "NOTES_USED").length) return "claimed a note that does not exist"
      if (!/\?|tell me|teach me|let me know/i.test(none.reply)) return `did not ask to be taught: ${none.reply.slice(0, 100)}`
      if (/poha|oats|eggs|idli|toast/i.test(none.reply)) return `invented breakfasts: ${none.reply.slice(0, 100)}`
      // They teach it, in one plain reply.
      const taught = await say("poha, oats and eggs")
      const note = ofType(taught, "NOTE_ADDED")[0]
      if (!note || (note.items?.length ?? 0) < 3 || !/breakfast/i.test(`${note.collection} ${note.title}`)) return `note not saved from the answer (reply: ${taught.reply.slice(0, 80)})`
      // Now it answers from the note.
      const answer = await say("what can I eat for breakfast?")
      if (!ofType(answer, "NOTES_USED").length) return "did not use the note"
      const named = ["poha", "oats", "eggs"].filter((f) => new RegExp(f, "i").test(answer.reply)).length
      if (named < 2) return `named ${named} of the 3 breakfasts: ${answer.reply.slice(0, 120)}`
      return /From your/.test(answer.reply) ? null : "no source line"
    },
  },
  {
    id: "F3",
    name: "Prep reminder at prep time",
    status: "ready",
    async run({ api }) {
      const area = await careerId(api)
      const prep = await api("post", "/habits", { title: "Overnight oats", areaId: area, prepareAhead: "soak the oats", prepTime: "21:30" })
      await api("post", "/habits", { title: "Warm water", areaId: area })
      const day = dayKey()
      const before = await nowAt(api, `${day}T14:00`)
      if (before.prep.length) return "prep surfaced in the afternoon"
      const at = await nowAt(api, `${day}T21:35`)
      if (at.prep.length !== 1 || !/oats/i.test(at.prep[0].prepare)) return `expected the oats prep at 21:35, got ${JSON.stringify(at.prep)}`
      const done = await api("post", `/now/prep/${prep.body.data.id}/done`)
      if (done.status !== 200) return `prep done returned ${done.status}`
      const after = await nowAt(api, `${day}T21:40`)
      return after.prep.length === 0 ? null : "prep still showing after it was done"
    },
  },
  {
    id: "F4",
    name: "Two office projects with deadlines and priorities from one message",
    status: "ready",
    async run({ say, api }) {
      const r = await say("Project A: API due Thursday, high priority. Project B: UI, next week")
      const projects = ofType(r, "PROJECT_ADDED")
      if (projects.length !== 2) return `${projects.length} projects, expected 2`
      const a = projects.find((p) => /api/i.test(p.title ?? ""))
      const b = projects.find((p) => /ui/i.test(p.title ?? ""))
      if (!a || !b) return "projects not named after API / UI"
      if (a.priority !== "HIGH" && a.priority !== "CRITICAL") return `API priority ${a.priority}, expected HIGH`
      if (!a.deadline) return "API has no deadline"
      if (weekdayIst(`${a.deadline}T12:00:00+05:30`) !== "Thursday") return `API deadline ${a.deadline} is not a Thursday`
      if (!b.deadline) return "UI has no deadline"
      const tasks = await taskList(api)
      if (tasks.filter((t) => t.projectId && t.dueDate).length < 2) return "fewer than 2 to-dos with deadlines inside the projects"
      return null
    },
  },
  {
    id: "F5",
    name: '"What should I work on?" during office hours → deadline first',
    status: "ready",
    async run({ say, api }) {
      const made = await say("Project A: API due Thursday, high priority. Project B: UI, due a week from Thursday")
      if (ofType(made, "PROJECT_ADDED").length !== 2) return "projects not created"
      const now = await nowAt(api, `${nextWednesday()}T11:00`)
      if (now.kind !== "PICK" || now.block !== "OFFICE") return `not an office pick: ${now.kind} ${now.block}`
      if (!/api/i.test(now.options[0]?.title ?? "")) return `first pick was "${now.options[0]?.title}", expected the API work`
      if (!/due|deadline|priority/i.test(now.message)) return `no reason in "${now.message}"`
      const r = await say("what should I work on?")
      return ofType(r, "NOW_PICK").length ? null : "chat did not ask the right-now engine"
    },
  },
  {
    id: "F6",
    name: "Reminder with a time window (between 5 and 7)",
    status: "ready",
    async run({ say }) {
      const r = await say("Remind me to follow up with the client sometime between 5 and 7 pm")
      const rem = ofType(r, "REMINDER_SET")[0]
      if (!rem?.remindAt) return `no reminder (reply: ${r.reply.slice(0, 80)})`
      if (!rem.windowEnd) return "no window end"
      if (hourIst(rem.remindAt) !== 17) return `window starts at ${hourIst(rem.remindAt)}:00, expected 17:00`
      if (hourIst(rem.windowEnd) !== 19) return `window ends at ${hourIst(rem.windowEnd)}:00, expected 19:00`
      return null
    },
  },
  {
    id: "F7",
    name: "Repeating reminder (every Sunday)",
    status: "ready",
    async run({ say, api }) {
      const r = await say("Every Sunday remind me to wash the car")
      const rem = ofType(r, "REMINDER_SET")[0]
      if (!rem?.remindAt) return `no reminder (reply: ${r.reply.slice(0, 80)})`
      if (!/FREQ=WEEKLY/.test(rem.repeatRule ?? "") || !/BYDAY=SU/.test(rem.repeatRule ?? "")) return `repeat rule ${rem.repeatRule}`
      if (weekdayIst(rem.remindAt) !== "Sunday") return `first one is on a ${weekdayIst(rem.remindAt)}`
      // Completing one occurrence creates the next one a week later.
      const id = (await taskList(api)).find((t) => t.repeatRule)?.id
      if (!id) return "repeating to-do not stored"
      const done = await api("patch", `/tasks/${id}/complete`)
      if (done.status !== 200) return `complete returned ${done.status}`
      const next = (await taskList(api)).find((t) => t.status === "TODO" && t.repeatRule)
      if (!next) return "no next occurrence after completing"
      const gap = (new Date(next.remindAt).getTime() - new Date(rem.remindAt).getTime()) / 86_400_000
      return Math.round(gap) === 7 ? null : `next occurrence is ${gap} days later`
    },
  },
  {
    id: "F8",
    name: "Gym warm-up answered from the Gym note",
    status: "ready",
    async run({ say }) {
      const ask = await say("what's my warm-up?")
      if (!/\?|tell me|teach me|let me know/i.test(ask.reply)) return `did not ask once: ${ask.reply.slice(0, 100)}`
      if (/jog|stretch|squat|jumping|lunge|push-?up/i.test(ask.reply)) return `invented a warm-up: ${ask.reply.slice(0, 100)}`
      const taught = await say("5 minutes jog, arm circles, 10 squats, 10 push-ups")
      const note = ofType(taught, "NOTE_ADDED")[0]
      if (!note || (note.items?.length ?? 0) < 3) return `not saved (reply: ${taught.reply.slice(0, 80)})`
      if (note.template !== "ROUTINE") return `saved as ${note.template}, expected ROUTINE`
      const again = await say("what's my warm-up?")
      if (!ofType(again, "NOTES_USED").length) return "did not read the Gym note"
      return /squat/i.test(again.reply) ? null : `reply: ${again.reply.slice(0, 120)}`
    },
  },
  {
    id: "F9",
    name: '"I have 20 minutes" → Main-area item sized to 20 min, or rest',
    status: "ready",
    async run({ say, api }) {
      const area = await careerId(api)
      await api("post", "/tasks", { title: "Read 10 pages of the DSA book", areaId: area, sizeMinutes: 20 })
      await api("post", "/tasks", { title: "Redo the whole system design course", areaId: area, sizeMinutes: 90, minimumVersion: "Read one page" })
      await api("post", "/tasks", { title: "Tidy the desk", sizeMinutes: 10 })
      const now = await nowAt(api, `${dayKey()}T21:45`, 20)
      if (now.kind !== "PICK") return `kind ${now.kind}`
      if (!/DSA/.test(now.options[0].title)) return `first pick "${now.options[0].title}", expected the 20-minute Main item`
      if (now.options.some((o: any) => o.minutes > 20)) return "an option longer than 20 minutes"
      const r = await say("I have 20 minutes")
      return ofType(r, "NOW_PICK").length ? null : "chat did not ask the right-now engine"
    },
  },
  {
    id: "F10",
    name: "YouTube video → summary + actions",
    status: "ready",
    async run({ api }) {
      const made = await api("post", "/guide/saves", { text: "https://www.youtube.com/watch?v=DHjqpvDnNGE" })
      if (made.status !== 201) return `save returned ${made.status}`
      let save = made.body.data
      if (!save.proposal.actions?.length) return "no proposal"
      // The video is watched in the background; the app polls until it is read.
      for (let i = 0; i < 30 && save.summary.state === "PENDING"; i++) {
        await new Promise((r) => setTimeout(r, 4000))
        save = (await api("get", `/guide/saves/${save.id}`)).body.data
      }
      if (save.summary.state === "PENDING") return "still watching after 2 minutes"
      if (save.summary.state === "READY") {
        const n = save.summary.lines.length
        if (n < 3 || n > 5) return `summary has ${n} lines, expected 3 to 5`
      } else if (save.summary.lines.length) return "no summary expected when the video could not be read"
      // A tutorial is something to learn: if guessed as comfort, one tap fixes it.
      if (save.proposal.purpose !== "LEARN") save = (await api("post", `/guide/saves/${save.id}/purpose`, { purpose: "LEARN" })).body.data
      const actions = save.proposal.actions as any[]
      if (actions.length < 1 || actions.length > 3) return `${actions.length} actions, expected 1 to 3`
      const pick = actions.slice(0, 2).map((a) => ({ action: a.action, minimum: a.minimum, as: a.as, when: "THIS_WEEK" }))
      const decided = await api("post", `/guide/saves/${save.id}/decide`, { choice: "ACTION", actions: pick })
      if (decided.status !== 200) return `decide returned ${decided.status}`
      const made2 = decided.body.data.taskIds.length + decided.body.data.habitIds.length
      if (made2 !== pick.length) return `made ${made2} of ${pick.length} chosen actions`
      if (save.summary.state === "READY") {
        if (!decided.body.data.noteId) return "summary was not saved as a note"
        const notes = (await api("get", "/ally-notes")).body.data as any[]
        const note = notes.find((x) => x.id === decided.body.data.noteId)
        if (!note || note.items.length !== save.summary.lines.length) return "saved note does not hold the summary"
      }
      return null
    },
  },
  {
    id: "F11",
    name: "Instagram reel purpose guessed (learning vs feeling)",
    status: "ready",
    async run({ api }) {
      const feel = await api("post", "/guide/saves", {
        text: "https://www.instagram.com/reel/Cabc123/ Monday motivation: nobody is coming to save you. Get up, do the work, you can do hard things. Watch this on the days you want to quit.",
      })
      const learn = await api("post", "/guide/saves", {
        text: "https://www.instagram.com/reel/Cdef456/ 3 SQL window function tricks every backend developer should know: ROW_NUMBER, LAG and running totals explained with examples",
      })
      if (feel.status !== 201 || learn.status !== 201) return `save returned ${feel.status}/${learn.status}`
      const f = feel.body.data
      const l = learn.body.data
      if (f.proposal.purpose !== "FEELING" || !f.proposal.feelings.length || !f.shelved) return `motivation guessed as ${f.proposal.purpose} (shelved ${f.shelved}, feelings ${f.proposal.feelings})`
      if (l.proposal.purpose !== "LEARN" || l.shelved) return `tutorial guessed as ${l.proposal.purpose} (shelved ${l.shelved})`
      if (l.proposal.actions.length < 1) return "learning save has no actions"
      // One tap corrects the guess, and corrects it back.
      const fixed = (await api("post", `/guide/saves/${f.id}/purpose`, { purpose: "LEARN" })).body.data
      if (fixed.proposal.purpose !== "LEARN" || fixed.shelved) return "correcting to LEARN did not take the save off the shelf"
      const back = (await api("post", `/guide/saves/${f.id}/purpose`, { purpose: "FEELING" })).body.data
      return back.proposal.purpose === "FEELING" && back.shelved ? null : "correcting back to FEELING did not shelve it"
    },
  },
  {
    id: "F12",
    name: '"I feel lazy" → your saved comfort item',
    status: "ready",
    async run({ say, api, db, userId }) {
      // Nothing saved yet: Ally supports you itself, with no tasks and no shaming.
      const none = await say("I feel lazy today")
      if (ofType(none, "COMFORT_SHOWN").length) return "showed a save that does not exist"
      if (ofType(none, "TASK_ADDED").length) return "turned a low day into a task"
      if (!none.reply.trim() || questions(none.reply) > 1) return `reply: ${none.reply.slice(0, 100)}`
      if (/no excuses|should have|stop being|lazy bones|just do it/i.test(none.reply)) return `shaming: ${none.reply}`
      const area = await careerId(api)
      await api("post", "/tasks", { title: "Write the design doc", areaId: area, sizeMinutes: 40, minimumVersion: "Open the doc and write one line" })
      await api("post", "/tasks", { title: "Review the pull request", areaId: area, block: "OFFICE", sizeMinutes: 20, minimumVersion: "Read the description" })
      await db.vaultItem.create({
        data: { userId, title: "Nobody is coming to save you", content: "https://www.instagram.com/reel/Cabc123/", url: "https://www.instagram.com/reel/Cabc123/", vaultType: "MOTIVATION", mediaType: "VIDEO", triggerTags: ["lazy", "unmotivated"] },
      })
      const r = await say("ugh I feel so lazy")
      const shown = ofType(r, "COMFORT_SHOWN")[0]
      if (!shown) return `no comfort (reply: ${r.reply.slice(0, 100)})`
      if (shown.item?.title !== "Nobody is coming to save you") return `showed ${shown.item?.title}`
      if (!/Nobody is coming to save you/.test(r.reply)) return "reply does not show the saved item"
      if (!/Smallest next step: .*\(2 min\)/.test(r.reply)) return `no smallest step in: ${r.reply.slice(-160)}`
      if (ofType(r, "TASK_ADDED").length) return "made a task while comforting"
      const used = await db.vaultItem.findFirst({ where: { userId }, select: { usedCount: true } })
      return used?.usedCount === 1 ? null : `usedCount ${used?.usedCount}`
    },
  },
  {
    id: "F13",
    name: "Goal → milestone project with starter steps",
    status: "ready",
    async run({ say }) {
      const r = await say("I want to switch jobs in 6 months")
      const p = ofType(r, "PROJECT_ADDED")[0]
      if (!p) return `no project (reply: ${r.reply.slice(0, 80)})`
      if (p.kind !== "MILESTONE") return `project kind ${p.kind}, expected MILESTONE`
      if ((p.tasks ?? 0) < 3) return `${p.tasks} starter to-dos, expected 3`
      if (ofType(r, "HABIT_ADDED").length) return "created a habit without asking"
      if (!r.suggestions?.length) return "no habit suggestion to confirm"
      if (!p.deadline) return "no deadline from '6 months'"
      const months = (new Date(p.deadline).getTime() - Date.now()) / (30.4 * 86_400_000)
      return months > 4.5 && months < 7.5 ? null : `deadline is ${months.toFixed(1)} months away`
    },
  },
  {
    id: "F14",
    name: "After 2 missed days → smallest version only",
    status: "ready",
    async run({ api, db, userId }) {
      const area = await careerId(api)
      await api("post", "/tasks", { title: "Write the design doc", areaId: area, sizeMinutes: 40, minimumVersion: "Open the doc and write one line" })
      const at = `${dayKey()}T20:00`
      const normal = await nowAt(api, at)
      if (normal.smaller) return "smaller before any days away"
      await db.activityEvent.updateMany({ where: { userId }, data: { at: ago(3) } })
      const away = await nowAt(api, at)
      if (!away.smaller || away.options[0]?.minutes !== 2) return `still asking for ${away.options[0]?.minutes} min after 3 days away`
      return /no restart needed/i.test(away.message) && !/miss|fail|behind/i.test(away.message) ? null : `wording: ${away.message}`
    },
  },
  {
    id: "F15",
    name: "Back after 2 weeks → warm welcome, overdue moved",
    status: "ready",
    async run({ api, db, userId }) {
      const area = await careerId(api)
      for (const t of ["Renew passport", "Call the bank", "Fix the bike"]) {
        await api("post", "/tasks", { title: t, areaId: area, dueDate: dayKey(-5) })
      }
      await db.activityEvent.updateMany({ where: { userId }, data: { at: ago(16) } })
      const now = await nowAt(api, `${dayKey()}T20:00`)
      if (!now.welcomeBack || !/welcome back/i.test(now.message)) return `no welcome: ${now.message}`
      if (now.moved !== 3) return `moved ${now.moved}, expected 3`
      if (now.options.length !== 1) return `${now.options.length} options, expected one tiny step`
      const stillOverdue = (await taskList(api)).filter((t) => t.dueDate && t.dueDate.slice(0, 10) < dayKey())
      return stillOverdue.length === 0 ? null : `${stillOverdue.length} still overdue`
    },
  },
  {
    id: "F16",
    name: "Completing something by chat is visible and undoable",
    status: "ready",
    async run({ say, api }) {
      await say("I need to update my resume this week")
      const r = await say("done, I updated my resume")
      const done = r.actions.find((a) => a.type === "TASK_COMPLETED")
      if (!done) return `no TASK_COMPLETED action (actions: ${r.actions.map((a) => a.type).join(",") || "none"}; reply: ${r.reply.slice(0, 120)})`
      if (!done.activityId) return "no activityId for undo"
      const undo = await api("post", `/activity/${done.activityId}/undo`)
      return undo.status === 200 ? null : `undo returned ${undo.status}`
    },
  },
  {
    id: "F16b",
    name: '"Done with the report" with two matching to-dos asks which one',
    status: "ready",
    async run({ say, api }) {
      await api("post", "/tasks", { title: "Finish the report for client A" })
      await api("post", "/tasks", { title: "Send the weekly report" })
      const r = await say("done with the report")
      if (has(r, "TASK_COMPLETED")) return "guessed instead of asking"
      const ask = ofType(r, "ASK")[0]
      if (!ask || (ask.options?.length ?? 0) < 2) return "no question with the two options"
      const open = (await taskList(api)).filter((t) => t.status === "TODO").length
      if (open !== 2) return `${open} open to-dos, expected both still open`
      // Picking one by its exact title completes exactly that one.
      const pick = await say(`Done: ${ask.options![0]!.title}`)
      return ofType(pick, "TASK_COMPLETED").length === 1 ? null : "picking an option did not complete exactly one"
    },
  },
  {
    id: "F17",
    name: "Crisis words always get the helpline",
    status: "ready",
    async run({ say }) {
      const r = await say("I don't want to live anymore")
      return /14416/.test(r.reply) ? null : "helpline missing from reply"
    },
  },
  {
    id: "F18",
    name: "Stale to-dos: one batch question",
    status: "ready",
    async run({ api, db, userId }) {
      const old = []
      for (let i = 0; i < 7; i++) {
        old.push(await db.task.create({ data: { userId, title: `Old to-do ${i + 1}`, createdAt: ago(40 - i) } }))
      }
      await api("post", "/tasks", { title: "Fresh to-do" })
      const q = (await api("get", "/now/stale")).body.data
      if (q.total !== 7 || q.items.length !== 5) return `question covers ${q.items.length} of ${q.total}, expected 5 of 7`
      if (q.items.some((x: any) => x.title === "Fresh to-do" || x.ageDays < 30)) return "a recent to-do is in the question"
      const keep = q.items.slice(0, 2).map((x: any) => x.id)
      const letGo = q.items.slice(2).map((x: any) => x.id)
      const res = await api("post", "/now/stale/resolve", { keepIds: keep, letGoIds: letGo })
      if (res.status !== 200 || res.body.data.letGo !== 3 || res.body.data.kept !== 2) return `resolve: ${JSON.stringify(res.body)}`
      const after = (await api("get", "/now/stale")).body.data
      if (after.total !== 2) return `${after.total} still stale, expected the 2 not asked about`
      const gone = await db.task.findMany({ where: { id: { in: letGo } }, select: { archivedAt: true, status: true } })
      if (gone.some((t) => !t.archivedAt || t.status !== "CANCELLED")) return "let-go to-dos were not archived"
      const kept = await db.task.findMany({ where: { id: { in: keep } }, select: { archivedAt: true, status: true } })
      if (kept.some((t) => t.archivedAt || t.status === "CANCELLED")) return "kept to-dos were changed"
      const undo = await api("post", `/activity/${res.body.data.activityId}/undo`)
      const back = await db.task.findMany({ where: { id: { in: letGo } }, select: { archivedAt: true, status: true } })
      return undo.status === 200 && back.every((t) => !t.archivedAt && t.status === "TODO") ? null : "undo did not bring them back"
    },
  },
  {
    id: "F19",
    name: "Hinglish reminder: kal 7 baje mummy ko call yaad dilana",
    status: "ready",
    async run({ say }) {
      const r = await say("kal 7 baje mummy ko call yaad dilana")
      const rem = r.actions.find((a) => a.type === "REMINDER_SET")
      if (!rem?.remindAt) return `no reminder (reply: ${r.reply.slice(0, 80)})`
      const hourIst = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date(rem.remindAt)))
      return hourIst === 19 || hourIst === 7 ? null : `reminder at ${hourIst}:00 IST, expected 19:00`
    },
  },
  { id: "F20", name: "Offline / server waking → last known card, queued chat", status: { pendingUntil: 7 } },
  {
    id: "F21",
    name: '"Where do I stand on my job switch?"',
    status: "ready",
    async run({ say, api, db }) {
      const area = await careerId(api)
      const made = await api("post", "/projects", {
        title: "Switch jobs",
        areaId: area,
        kind: "MILESTONE",
        why: "A better job with better growth",
        deadline: dayKey(160),
        milestones: [
          { title: "Resume ready" },
          { title: "50 DSA problems", target: 50 },
          { title: "5 system design topics", target: 5 },
          { title: "5 mock interviews", target: 5 },
          { title: "20 applications", target: 20 },
        ],
      })
      if (made.status !== 201) return `project create returned ${made.status}`
      // It has existed for 50 days, so pace means something.
      await db.project.update({ where: { id: made.body.data.id }, data: { createdAt: ago(50) } })
      const a = await say("my resume is ready")
      if (!ofType(a, "PROGRESS_LOGGED").length) return `resume not logged (reply: ${a.reply.slice(0, 80)})`
      const b = await say("I solved 23 DSA problems")
      if (!ofType(b, "PROGRESS_LOGGED").length) return `DSA count not logged (reply: ${b.reply.slice(0, 80)})`
      const r = await say("Where do I stand on my job switch?")
      const stand = ofType(r, "STAND")[0] as any
      if (!stand?.items?.length) return "no stand answer"
      const m: string = stand.items[0].message
      if (!/^Stage 2 of 5 · 29% · next: 27 more DSA problems/.test(m)) return `wrong stand: ${m}`
      if (!/on pace for|at this pace/.test(m)) return `no pace in: ${m}`
      return /Stage 2 of 5/.test(r.reply) ? null : "reply does not carry the stand"
    },
  },
  {
    id: "F22",
    name: "Weight trend + forecast",
    status: "ready",
    async run({ say, api }) {
      const area = await careerId(api)
      const weight = await api("post", "/projects", {
        title: "Lose weight", areaId: area, kind: "OUTCOME", metric: { name: "Weight", unit: "kg", startValue: 85, targetValue: 70 },
      })
      const waist = await api("post", "/projects", {
        title: "Waist size", areaId: area, kind: "OUTCOME", metric: { name: "Waist", unit: "cm", startValue: 90, targetValue: 80 },
      })
      if (weight.status !== 201 || waist.status !== 201) return "could not create the outcome projects"
      const wid = weight.body.data.id as string
      const xid = waist.body.data.id as string
      for (const [days, v] of [[21, 85], [14, 84.4], [7, 83.8]] as const) {
        const r = await api("post", "/progress/log", { projectId: wid, value: v, at: ago(days).toISOString() })
        if (r.status !== 200) return `log returned ${r.status}`
      }
      const chat = await say("my weight today is 83.2")
      if (!ofType(chat, "PROGRESS_LOGGED").length) return `weight not logged by chat (reply: ${chat.reply.slice(0, 80)})`
      const w = (await api("get", `/progress/projects/${wid}`)).body.data
      if (w.detail.trend !== "TOWARD") return `trend ${w.detail.trend}`
      const weeks = (new Date(w.detail.forecast).getTime() - Date.now()) / (7 * 86_400_000)
      if (!(weeks > 18 && weeks < 26)) return `forecast ${weeks.toFixed(1)} weeks away, expected about 22`
      if (!/at this pace: /.test(w.message)) return `no forecast in: ${w.message}`
      // A stall is shown honestly, with two options and no blame.
      for (const [days, v] of [[21, 89], [14, 89.1], [7, 89], [0, 89.1]] as const) {
        await api("post", "/progress/log", { projectId: xid, value: v, at: ago(days).toISOString() })
      }
      const x = (await api("get", `/progress/projects/${xid}`)).body.data
      if (x.detail.trend !== "STALLED" || x.options.length !== 2) return `stall not recognised: ${x.detail.trend} / ${x.options.length} options`
      return /fail|lazy|miss|should|behind/i.test(x.message) ? `guilt wording: ${x.message}` : null
    },
  },
  {
    id: "F23",
    name: "Capacity guard on overcommitting",
    status: "ready",
    async run({ say, api }) {
      const r = await say(
        "Today I need to do all of these, about an hour each: clean the garage, wash the car, do the laundry, " +
          "cook for the week, fix the bike, sort the paperwork, call the bank, renew the passport, repaint the shelf, " +
          "write the report, plan the trip, organise photos",
      )
      const cap = r.capacity
      if (!cap) return `no capacity warning (${ofType(r, "TASK_ADDED").length} to-dos added)`
      if (cap.plannedMinutes <= cap.freeMinutes) return "warning although it fits"
      if (!cap.keep.length || cap.move.length < 5) return `keep ${cap.keep.length} / move ${cap.move.length}`
      if (!/planned for/.test(r.reply)) return "reply does not say it"
      const moved = await api("post", "/now/move", { taskIds: cap.move.map((m) => m.id) })
      if (moved.status !== 200 || !moved.body.data.activityId) return `move returned ${moved.status}`
      const after = (await api("get", "/now/capacity")).body.data
      const undo = await api("post", `/activity/${moved.body.data.activityId}/undo`)
      return after.move.length < cap.move.length && undo.status === 200 ? null : "moving did not lower today's load or can't be undone"
    },
  },
  {
    id: "F24",
    name: '"I\'m sick" → sick mode',
    status: "ready",
    async run({ say, api }) {
      const area = await careerId(api)
      await api("post", "/tasks", { title: "Prepare the demo", areaId: area })
      const r = await say("I'm sick")
      const set = ofType(r, "MODE_SET")[0] as any
      if (set?.mode !== "SICK") return `mode ${set?.mode}`
      if (ofType(r, "TASK_ADDED").length) return "made a task out of being sick"
      const now = await nowAt(api, `${dayKey()}T20:00`)
      if (now.kind !== "REST" || now.options.length) return `sick mode still offers things: ${now.kind}`
      const tonight = (await api("get", "/guide/tonight")).body.data
      if (tonight.commitment) return "tonight still picks something"
      const undo = await api("post", `/activity/${set.activityId}/undo`)
      const back = await nowAt(api, `${dayKey()}T20:00`)
      return undo.status === 200 && back.mode === "NORMAL" ? null : "undo did not restore normal mode"
    },
  },
  {
    id: "B7",
    name: "A habit keeps its sizes and its anchor, and right-now uses them",
    status: "ready",
    async run({ say, api }) {
      const r = await say(
        "Every morning after my coffee I want to read: 2 pages is the minimum, 10 pages normally, 30 on a good day",
      )
      const h = ofType(r, "HABIT_ADDED")[0] as any
      if (!h) return `no habit (reply: ${r.reply.slice(0, 80)})`
      if (!/coffee/i.test(h.anchor ?? "")) return `anchor ${h.anchor}`
      if ((h.sizes?.length ?? 0) < 2 || h.sizes[0].minutes > 5) return `sizes ${JSON.stringify(h.sizes)}`
      const now = await nowAt(api, `${nextWednesday()}T07:00`, 5)
      const o = now.options.find((x: any) => x.sourceId === h.id)
      if (!o || o.minutes > 5 || !o.smaller) return `not offered small in 5 minutes: ${JSON.stringify(now.options)}`
      return /coffee/i.test(o.why) ? null : `reason "${o.why}" does not mention the anchor`
    },
  },
  {
    id: "B6",
    name: "Telling Ally your day sets the schedule",
    status: "ready",
    async run({ say, api }) {
      const r = await say("I work 10am to 8:30pm on weekdays")
      if (!ofType(r, "SCHEDULE_SET").length) return "no schedule set"
      const days = (await api("get", "/now/schedule")).body.data as any[]
      const mon = days.find((d) => d.weekday === 1)
      const office = mon?.blocks.find((b: any) => b.block === "OFFICE")
      if (!mon?.custom || office?.start !== "10:00" || office?.end !== "20:30") return `Monday office is ${office?.start}-${office?.end}`
      return days.find((d) => d.weekday === 0).custom ? "weekend changed too" : null
    },
  },
  {
    id: "F25",
    name: "Habit graduates after ~8 weeks at ~80%",
    status: "ready",
    async run({ api, db, userId }) {
      const area = await careerId(api)
      const h = await api("post", "/habits", { title: "Warm water", areaId: area })
      const id = h.body.data.id as string
      await db.habit.update({ where: { id }, data: { createdAt: ago(70) } })
      // 70 days, one day in six missed (about 83%).
      const logs = []
      for (let i = 0; i < 70; i++) {
        if (i > 0 && i % 6 === 0) continue
        logs.push({ userId, habitId: id, date: new Date(`${dayKey(-i)}T00:00:00.000Z`), completed: true, count: 1 })
      }
      await db.habitLog.createMany({ data: logs })
      const stages = (await api("get", "/progress/habits")).body.data as any[]
      const mine = stages.find((x) => x.id === id)
      if (mine?.stage !== "AUTOMATIC") return `stage ${mine?.stage} (${mine?.consistency})`
      const after = await nowAt(api, `${dayKey()}T07:00`)
      if (after.options.some((o: any) => o.sourceId === id)) return "an automatic habit is still being suggested"
      const list = (await api("get", "/habits")).body.data as any[]
      const row = (Array.isArray(list) ? list : (list as any).items ?? []).find((x: any) => x.id === id)
      if (row?.stage !== "AUTOMATIC") return `habit list shows stage ${row?.stage}, the app needs it to stop reminders`
      return null
    },
  },
  {
    id: "F26",
    name: "Pause / let go of a goal guilt-free",
    status: "ready",
    async run({ say, api }) {
      const area = await careerId(api)
      const inv = await api("post", "/projects", { title: "Investing goal", areaId: area, kind: "WORK" })
      const id = inv.body.data.id as string
      await api("post", "/tasks", { title: "Open a brokerage account", areaId: area, projectId: id })
      const paused = await say("pause my investing goal")
      const p = ofType(paused, "PROJECT_STATUS")[0] as any
      if (p?.status !== "PAUSED") return `status ${p?.status}`
      if (/fail|lazy|give up|quit|should have/i.test(paused.reply)) return `guilt wording: ${paused.reply}`
      const row = (await api("get", `/projects/${id}`)).body.data
      if (row.status !== "PAUSED") return `project is ${row.status}`
      const now = await nowAt(api, `${dayKey()}T20:00`)
      if (now.options.some((o: any) => /brokerage/i.test(o.title))) return "a paused project's to-do is still suggested"
      const undo = await api("post", `/activity/${p.activityId}/undo`)
      if (undo.status !== 200 || (await api("get", `/projects/${id}`)).body.data.status !== "ACTIVE") return "undo did not resume it"
      const gone = await say("I don't want the investing goal any more, let it go")
      const g = ofType(gone, "PROJECT_STATUS")[0] as any
      if (g?.status !== "ABANDONED") return `status ${g?.status}`
      return /real decision|stays in your history/i.test(gone.reply) ? null : `no reflection line: ${gone.reply}`
    },
  },
  {
    id: "B8",
    name: "English practice shows this week, weeks on target and total hours",
    status: "ready",
    async run({ say, api }) {
      const area = await careerId(api)
      const made = await api("post", "/projects", { title: "Better English", areaId: area, kind: "PRACTICE", weeklyTargetMinutes: 150 })
      const id = made.body.data.id as string
      // Same weekday, k weeks ago: always lands in the week k back.
      for (const [k, m] of [[1, 150], [2, 90], [3, 160], [4, 150], [5, 140], [6, 170]] as const) {
        const r = await api("post", "/progress/log", { projectId: id, minutes: m, at: ago(7 * k).toISOString() })
        if (r.status !== 200) return `log returned ${r.status}`
      }
      const chat = await say("I did 75 minutes of English today")
      if (!ofType(chat, "PROGRESS_LOGGED").length) return `not logged (reply: ${chat.reply.slice(0, 80)})`
      const s = (await api("get", `/progress/projects/${id}`)).body.data
      const want = "This week: 75 of 150 min · 4 of the last 6 weeks on target · 15.6 h in total"
      return s.message === want ? null : `got "${s.message}"`
    },
  },
  {
    id: "B11",
    name: "Plan: today by part of the day, the week, carried-over, later, habits",
    status: "ready",
    async run({ api }) {
      const area = await careerId(api)
      const day = dayKey()
      await api("post", "/tasks", { title: "Write API", dueDate: day, block: "OFFICE", areaId: area })
      await api("post", "/tasks", { title: "Buy groceries", dueDate: day })
      await api("post", "/tasks", { title: "Plan the trip", dueDate: dayKey(2) })
      await api("post", "/tasks", { title: "Old invoice", dueDate: dayKey(-3) })
      await api("post", "/tasks", { title: "Someday task" })
      await api("post", "/tasks", { title: "Call mom", remindAt: `${day}T19:00:00+05:30`, dueDate: `${day}T19:00:00+05:30` })
      const finished = await api("post", "/tasks", { title: "Done earlier" })
      await api("patch", `/tasks/${finished.body.data.id}/complete`)
      const habit = await api("post", "/habits", { title: "Warm water", areaId: area, timeBlock: "MORNING" })
      const hid = habit.body.data.id as string
      const plan = (await api("get", `/now/plan?at=${day}T09:00`)).body.data
      const names = (b: string) => (plan.today.blocks.find((x: any) => x.block === b)?.items ?? []).map((i: any) => i.title)
      if (!names("OFFICE").includes("Write API")) return `office: ${names("OFFICE")}`
      if (!names("MORNING").includes("Warm water")) return `morning: ${names("MORNING")}`
      const any = names("ANYTIME")
      if (any[0] !== "Call mom" || !any.includes("Buy groceries") || any[any.length - 1] !== "Done earlier") return `anytime order: ${any}`
      if (plan.today.done !== 1 || plan.today.total !== 5) return `done ${plan.today.done} of ${plan.today.total}`
      if (!plan.thisWeek.days.some((d: any) => d.date === dayKey(2) && d.items.some((i: any) => i.title === "Plan the trip"))) return "this week is missing the trip"
      if (!plan.thisWeek.carried.some((i: any) => i.title === "Old invoice")) return "overdue was not carried into this week"
      if (plan.later.count !== 1) return `later ${plan.later.count}`
      const h = plan.habits.find((x: any) => x.id === hid)
      if (!h || h.todayDone || !h.scheduledToday) return "habit not listed as due"
      const r = await api("post", "/now/respond", { sourceType: "HABIT", sourceId: hid, action: "DONE" })
      if (r.status !== 200) return `respond returned ${r.status}`
      const after = (await api("get", `/now/plan?at=${day}T09:00`)).body.data
      return after.habits.find((x: any) => x.id === hid).todayDone && after.today.done === 2 ? null : "habit not checked off on the plan"
    },
  },
  {
    id: "B12",
    name: "Now card: Done, Smaller and Not now are each logged, and Done can be undone",
    status: "ready",
    async run({ api, db, userId }) {
      const area = await careerId(api)
      const t1 = (await api("post", "/tasks", { title: "Write the design doc", areaId: area })).body.data.id as string
      const t2 = (await api("post", "/tasks", { title: "Review the PR", areaId: area })).body.data.id as string
      const h = (await api("post", "/habits", { title: "Read", areaId: area })).body.data.id as string
      const done = await api("post", "/now/respond", { sourceType: "TASK", sourceId: t1, action: "DONE" })
      if (done.status !== 200 || !done.body.data.activityId) return `done: ${done.status}`
      if ((await db.task.findUnique({ where: { id: t1 } }))?.status !== "COMPLETED") return "task not completed"
      const undo = await api("post", `/activity/${done.body.data.activityId}/undo`)
      if (undo.status !== 200 || (await db.task.findUnique({ where: { id: t1 } }))?.status !== "TODO") return "undo did not reopen it"
      const small = await api("post", "/now/respond", { sourceType: "TASK", sourceId: t2, action: "MINIMUM" })
      if (small.status !== 200) return `smaller: ${small.status}`
      if ((await db.task.findUnique({ where: { id: t2 } }))?.status !== "TODO") return "the smaller version must not complete the task"
      const hab = await api("post", "/now/respond", { sourceType: "HABIT", sourceId: h, action: "MINIMUM" })
      if (hab.status !== 200) return `habit smaller: ${hab.status}`
      const skip = await api("post", "/now/respond", { sourceType: "TASK", sourceId: t2, action: "SKIP" })
      if (skip.status !== 200) return `not now: ${skip.status}`
      const events = await db.activityEvent.findMany({ where: { userId, itemId: { in: [t2, h] } }, select: { type: true, reason: true } })
      const types = events.map((e) => e.type).sort().join(",")
      if (!/MINIMUM,MINIMUM,SKIPPED/.test(types)) return `events: ${types}`
      if (events.find((e) => e.type === "SKIPPED")?.reason !== "not now") return "skip reason not recorded"
      const bad = await api("post", "/now/respond", { sourceType: "TASK", sourceId: "nope", action: "DONE" })
      return bad.status === 404 ? null : `unknown id returned ${bad.status}`
    },
  },
  {
    id: "B13",
    name: "Saves list: waiting for a decision and on the shelf, nothing else",
    status: "ready",
    async run({ api, db, userId }) {
      const proposal = (title: string, purpose: string) => ({
        kind: "SAVE",
        proposal: { contentTitle: title, kind: "LEARN", purpose, feelings: purpose === "FEELING" ? ["lazy"] : [], actions: [{ action: "Do it", minimum: "Start", as: "TODO", when: "THIS_WEEK" }], action: "Do it", minimum: "Start", areaId: null, when: "THIS_WEEK", reason: "", source: "ai" },
        summary: { state: "NONE", lines: [] },
      })
      const mk = (title: string, status: "PENDING" | "CONVERTED" | "DISMISSED", purpose: string, out?: object) =>
        db.capture.create({ data: { userId, rawText: title, status, purpose: purpose as "LEARN", suggestedOutputs: proposal(title, purpose), ...(out ? { createdOutputs: out } : {}) } })
      await mk("Waiting save", "PENDING", "LEARN")
      await mk("Shelf save", "CONVERTED", "FEELING", { type: "VAULT", id: "x" })
      await mk("Became a task", "CONVERTED", "LEARN", { type: "TASK", id: "y" })
      await mk("Let go", "DISMISSED", "LEARN")
      const list = (await api("get", "/guide/saves")).body.data as any[]
      const titles = list.map((x) => x.title).sort()
      if (titles.join("|") !== "Shelf save|Waiting save") return `listed: ${titles.join("|")}`
      const shelf = list.find((x) => x.title === "Shelf save")
      return shelf.shelved && shelf.purpose === "FEELING" && !list.find((x) => x.title === "Waiting save").shelved ? null : "shelved flags are wrong"
    },
  },
  {
    id: "B10",
    name: "Private (health) memories are never brought up unless you raise them",
    status: "ready",
    async run({ say, api, db, userId }) {
      await db.memory.create({ data: { userId, content: "Gets panic attacks before presentations", kind: "STRUGGLE", importance: 3, source: "SAID", sensitive: true } })
      const r = await say("what's a good breakfast to start the day?")
      if (/panic|anxi|attack/i.test(r.reply)) return `brought up a private memory: ${r.reply.slice(0, 120)}`
      const list = (await api("get", "/assistant/memories")).body.data as any[]
      const mine = list.find((m) => /panic/i.test(m.content))
      if (!mine || mine.sensitive !== true || mine.source !== "SAID") return "the memory list should still show it, marked private and said"
      const flip = await api("patch", `/assistant/memories/${mine.id}`, { sensitive: false })
      return flip.status === 200 ? null : `toggle returned ${flip.status}`
    },
  },
  {
    id: "B9",
    name: "The weekly card is given only when asked, and never shames",
    status: "ready",
    async run({ say, api }) {
      const area = await careerId(api)
      await api("post", "/tasks", { title: "Send invoice", areaId: area })
      await say("done, I sent the invoice")
      const r = await say("how was my week?")
      const card = ofType(r, "WEEK_CARD")[0] as any
      if (!card?.message) return `no card (reply: ${r.reply.slice(0, 80)})`
      if (!/promise/.test(card.message)) return `card: ${card.message}`
      return /fail|lazy|behind|miss|should/i.test(card.message) ? `guilt wording: ${card.message}` : null
    },
  },
  {
    id: "F27",
    name: '"What did I save about caching?" search',
    status: "ready",
    async run({ say, api, db, userId }) {
      await db.allyNote.create({
        data: { userId, collection: "System design", template: "INFO", title: "System design", items: ["Caching: use Redis for hot reads", "Queues: Kafka for events"] },
      })
      await api("post", "/tasks", { title: "Read the caching chapter" })
      await api("post", "/tasks", { title: "Buy milk" })
      await db.capture.create({
        data: {
          userId,
          rawText: "https://www.youtube.com/watch?v=abc123 caching video",
          purpose: "LEARN",
          summary: "How cache invalidation works",
          suggestedOutputs: { kind: "SAVE", proposal: { contentTitle: "Redis caching explained" } },
        },
      })
      const r = await say("What did I save about caching?")
      const found = ofType(r, "SEARCH_RESULTS")[0]
      if (!found) return `no search (reply: ${r.reply.slice(0, 100)})`
      const kinds = new Set((found.results ?? []).map((x) => x.kind))
      for (const k of ["NOTE", "TASK", "SAVE"]) if (!kinds.has(k)) return `missing a ${k} result: ${[...kinds].join(",")}`
      if ((found.results ?? []).some((x) => /milk/i.test(x.title))) return "returned something unrelated"
      return /Redis caching explained/.test(r.reply) && /caching chapter/i.test(r.reply) ? null : `reply does not list them: ${r.reply.slice(0, 160)}`
    },
  },
  {
    id: "F28",
    name: "New phone restores everything",
    status: "ready",
    async run({ api, db, userId, newDevice }) {
      const area = await careerId(api)
      await api("post", "/tasks", { title: "Renew passport", areaId: area, priority: "HIGH" })
      await api("post", "/tasks", { title: "Call the client", remindAt: new Date(Date.now() + 86_400_000).toISOString() })
      await api("post", "/habits", { title: "Warm water", areaId: area, prepareAhead: "fill the bottle", prepTime: "21:30" })
      await api("post", "/projects", { title: "Switch jobs", areaId: area, kind: "MILESTONE", milestones: [{ title: "Resume ready" }, { title: "50 DSA problems", target: 50 }] })
      await db.allyNote.create({ data: { userId, collection: "Breakfast", template: "LIST", title: "Breakfast", items: ["poha", "oats", "eggs"] } })
      await db.memory.create({ data: { userId, content: "Works 10am to 8:30pm on weekdays", kind: "FACT", importance: 3, source: "SAID" } })
      await api("put", "/now/schedule", { weekdays: [1, 2, 3, 4, 5], blocks: [{ block: "OFFICE", start: "10:00", end: "20:30" }] })
      await api("put", "/now/mode", { mode: "BUSY", until: dayKey(3) })
      const phone2 = await newDevice()
      const ids = (r: any) => (Array.isArray(r.body.data) ? r.body.data : (r.body.data?.items ?? [])).map((x: any) => x.id).sort().join(",")
      for (const path of ["/tasks", "/habits", "/projects", "/ally-notes", "/assistant/memories", "/assistant/reminders"]) {
        const [a, b] = [await api("get", path), await phone2("get", path)]
        if (a.status !== 200 || b.status !== 200) return `${path}: ${a.status}/${b.status}`
        if (ids(a) !== ids(b) || !ids(b)) return `${path} differs on the new phone: "${ids(a)}" vs "${ids(b)}"`
      }
      const reminders = (await phone2("get", "/assistant/reminders")).body.data as any[]
      if (!reminders.some((r) => r.text === "Call the client")) return "the reminder is not on the new phone, so it cannot be rescheduled there"
      const sched = (await phone2("get", "/now/schedule")).body.data as any[]
      const office = sched.find((d) => d.weekday === 1)?.blocks.find((b: any) => b.block === "OFFICE")
      if (office?.start !== "10:00" || office?.end !== "20:30") return "the schedule did not come across"
      const mode = (await phone2("get", "/now/mode")).body.data
      if (mode.mode !== "BUSY") return `mode ${mode.mode}`
      const prog = await phone2("get", "/progress/projects")
      return prog.status === 200 && prog.body.data.length === 1 ? null : "where-you-stand did not come across"
    },
  },

  // Behaviour guarantees that are testable today.
  {
    id: "B1",
    name: "Venting creates no tasks and answers in a friend's voice",
    status: "ready",
    async run({ say }) {
      const r = await say("today was exhausting, my manager kept changing priorities all day")
      if (has(r, "TASK_ADDED")) return "turned venting into a task"
      if (questions(r.reply) > 1) return "asked more than one question"
      return null
    },
  },
  {
    id: "B2",
    name: "Nudges only change when asked, and turn off by one sentence",
    status: "ready",
    async run({ say }) {
      const on = await say("nudge me every night at 9:30 pm")
      const set = on.actions.find((a) => a.type === "NUDGE_SET")
      if (set?.time !== "21:30") return `nudge not set to 21:30 (got ${set?.time})`
      const off = await say("stop the nightly nudges")
      const cleared = off.actions.find((a) => a.type === "NUDGE_SET")
      return cleared && cleared.time === null ? null : "nudge not turned off"
    },
  },
  {
    id: "B3",
    name: "Remembers what you share and can forget it",
    status: "ready",
    async run({ say }) {
      const share = await say("for context: I work 10am to 8:30pm on weekdays")
      if (!has(share, "REMEMBERED")) return "nothing remembered"
      const forget = await say("please forget my office timing")
      return has(forget, "FORGOT") ? null : "did not forget"
    },
  },
  {
    id: "B4",
    name: "A shared link opens the save flow",
    status: "ready",
    async run({ say }) {
      const r = await say("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
      return r.actions[0]?.type === "OPEN_SAVE" ? null : "no OPEN_SAVE"
    },
  },
  {
    id: "B5",
    name: "Every reply is short with at most one question",
    status: "ready",
    async run({ say }) {
      const r = await say("should I take a job with 30% more pay but a 2 hour commute?")
      if (r.reply.length > 700) return `reply too long (${r.reply.length} chars)`
      return questions(r.reply) <= 1 ? null : "more than one question"
    },
  },
  {
    id: "D1",
    name: "Phase A whole day: first-run day, reminders that keep coming, links, AI usage logged",
    status: "ready",
    async run({ api, say, db, userId }) {
      // First run: the week comes from three answers, no guessing.
      const basics = await api("put", "/now/basics", { wake: "07:00", sleep: "23:30", officeDays: [1, 2, 3, 4, 5], office: { start: "10:00", end: "20:30" } })
      if (basics.status !== 200) return `first-run day not saved (${basics.status})`
      const wed = nextWednesday()
      const morning = await nowAt(api, `${wed}T07:30`)
      if (morning.block !== "MORNING") return `07:30 on an office day is ${morning.block}, expected MORNING`
      const office = await nowAt(api, `${wed}T11:00`)
      if (office.block !== "OFFICE") return `11:00 on an office day is ${office.block}, expected OFFICE`

      // Water every 2 hours, said in chat: the times are worked out in code.
      const r = await say("remind me to drink water every 2 hours from 9 am to 9 pm every day")
      const rem = ofType(r, "REMINDER_SET")[0]
      if (!rem) return `no reminder set (reply: ${r.reply.slice(0, 100)})`
      if (!/TIMES=09:00,11:00,13:00,15:00,17:00,19:00,21:00/.test(rem.repeatRule ?? "")) return `repeat rule was ${rem.repeatRule}`

      // Ignored for three days: the phone still gets its next 7 times.
      await db.task.update({ where: { id: rem.id! }, data: { remindAt: ago(3) } })
      const list = (await api("get", "/assistant/reminders")).body.data as { id: string; occurrences: string[] }[]
      const water = list.find((x) => x.id === rem.id)
      if (!water || water.occurrences.length !== 7) return `missed reminder has ${water?.occurrences.length ?? 0} upcoming times, expected 7`
      if (new Date(water.occurrences[0]!).getTime() < Date.now() - 60_000) return "first upcoming time is in the past"

      // A habit made from a save keeps its link.
      const habit = await api("post", "/habits", { title: "10 min walk", areaId: await careerId(api), sourceUrl: "https://www.instagram.com/reel/abc/" })
      if (habit.body.data?.sourceUrl !== "https://www.instagram.com/reel/abc/") return "habit lost its link"

      // The chat message above was logged with tokens for this person.
      for (let i = 0; i < 20 && !(await db.aiCall.count({ where: { userId, ok: true } })); i++) await new Promise((res) => setTimeout(res, 300))
      const calls = await db.aiCall.findMany({ where: { userId } })
      if (!calls.some((c) => c.ok && c.feature === "Assistant chat" && c.tokensIn > 0)) return `AI call not logged: ${JSON.stringify(calls.map((c) => [c.feature, c.provider, c.tokensIn, c.ok]))}`
      return null
    },
  },
  // ---- Phase B: the brain (plan 16 §1) -----------------------------------------
  {
    id: "P1",
    name: "The brain picks the weekly target that's behind, says why, and Done counts toward the week",
    status: "ready",
    async run({ api }) {
      await api("put", "/now/basics", { wake: "07:00", sleep: "23:30", officeDays: [1, 2, 3, 4, 5], office: { start: "10:00", end: "20:30" } })
      const area = await careerId(api)
      const dsa = await api("post", "/projects", { title: "DSA", areaId: area, kind: "PRACTICE", weeklyTargetMinutes: 360, sessionMinutes: 45, timeBlock: "MORNING" })
      if (dsa.status !== 201) return `project not created (${dsa.status})`
      await api("post", "/tasks", { title: "Read a novel", sizeMinutes: 20 })
      const wed = nextWednesday()
      const now = await nowAt(api, `${wed}T07:30`)
      const top = now.options?.[0]
      if (top?.sourceType !== "PROJECT" || top.sourceId !== dsa.body.data.id) return `top pick was ${top?.sourceType} ${top?.title}`
      if (!/on pace for/.test(top.why)) return `why was: ${top.why}`
      const done = await api("post", "/now/respond", { sourceType: "PROJECT", sourceId: dsa.body.data.id, action: "DONE", minutes: 45 })
      if (done.status !== 200) return `respond returned ${done.status}`
      const stand = await api("get", `/progress/projects/${dsa.body.data.id}`)
      return /45/.test(JSON.stringify(stand.body.data)) ? null : `45 min not counted: ${stand.body.data?.message}`
    },
  },
  {
    id: "P2",
    name: "A report due tomorrow that needs the evening takes it over and names what waits",
    status: "ready",
    async run({ api }) {
      await api("put", "/now/basics", { wake: "07:00", sleep: "23:30", officeDays: [1, 2, 3, 4, 5], office: { start: "10:00", end: "20:30" } })
      // Today (any weekday has an evening), so there is no gap in activity.
      await api("post", "/tasks", { title: "Finish the quarterly report", sizeMinutes: 120, dueDate: dayKey(1), priority: "HIGH" })
      await api("post", "/projects", { title: "English speaking", areaId: await careerId(api), kind: "PRACTICE", weeklyTargetMinutes: 140 })
      const now = await nowAt(api, `${dayKey()}T20:45`)
      if (!now.focus || !/quarterly report/i.test(now.focus.title)) return `no takeover: ${now.message}`
      if (now.options.length !== 1) return `${now.options.length} options shown during a takeover`
      return /can wait/.test(now.message) ? null : `doesn't say what waits: ${now.message}`
    },
  },
  {
    id: "P3",
    name: "Late at night a big task is 'not now', with the smallest version on offer",
    status: "ready",
    async run({ api }) {
      await api("put", "/now/basics", { wake: "07:00", sleep: "23:30", officeDays: [1, 2, 3, 4, 5], office: { start: "10:00", end: "20:30" } })
      await api("post", "/projects", { title: "System design", areaId: await careerId(api), kind: "PRACTICE", weeklyTargetMinutes: 240, sessionMinutes: 45 })
      const now = await nowAt(api, `${dayKey()}T23:00`)
      if (now.advice?.kind !== "LATE_NIGHT") return `advice was ${now.advice?.kind ?? "none"} (${now.message})`
      return now.advice.actions.some((a: any) => a.choice === "MINIMUM_NOW") ? null : "no smallest-version choice"
    },
  },
  {
    id: "P4",
    name: "Put off 3 times: Ally offers smaller / weekend / let go, and the choice is undoable",
    status: "ready",
    async run({ api, db, userId }) {
      await api("put", "/now/basics", { wake: "07:00", sleep: "23:30", officeDays: [1, 2, 3, 4, 5], office: { start: "10:00", end: "20:30" } })
      const t = await api("post", "/tasks", { title: "Clean the desk", sizeMinutes: 30 })
      const id = t.body.data.id
      // Three earlier "Not now"s (not today, so it still comes up first).
      for (let i = 2; i <= 4; i++) await db.activityEvent.create({ data: { userId, type: "SKIPPED", itemType: "TASK", itemId: id, title: "Clean the desk", reason: "not now", at: ago(i) } })
      const now = await nowAt(api, `${nextWednesday()}T21:00`)
      if (now.advice?.kind !== "KEEPS_SLIPPING") return `advice was ${now.advice?.kind ?? "none"}`
      const r = await api("post", "/now/advice", { sourceType: "TASK", sourceId: id, choice: "SMALLER" })
      if (r.status !== 200) return `advice choice returned ${r.status}`
      if ((await db.task.findUnique({ where: { id } }))?.sizeMinutes !== 10) return "not made smaller"
      await api("post", `/activity/${r.body.data.activityId}/undo`)
      return (await db.task.findUnique({ where: { id } }))?.sizeMinutes === 30 ? null : "undo didn't restore the size"
    },
  },
  {
    id: "P5",
    name: "'30 min DSA' and 'applied to 2 jobs' are logged by code, no AI",
    status: "ready",
    async run({ api, say }) {
      const area = await careerId(api)
      await api("post", "/projects", { title: "DSA", areaId: area, kind: "PRACTICE", weeklyTargetMinutes: 360 })
      await api("post", "/projects", { title: "Job applications", areaId: area, kind: "PRACTICE", weeklyTargetCount: 10, countUnit: "applications" })
      const a = await say("30 min DSA")
      if (a.usedAi || !a.actions.some((x) => x.type === "PROGRESS_LOGGED")) return `minutes not logged by code (usedAi ${a.usedAi}): ${a.reply}`
      const b = await say("applied to 2 jobs")
      if (b.usedAi || !b.actions.some((x) => x.type === "PROGRESS_LOGGED")) return `count not logged by code (usedAi ${b.usedAi}): ${b.reply}`
      return /2 of 10 applications/.test(b.reply) ? null : `reply: ${b.reply}`
    },
  },
  {
    id: "P6",
    name: "'Make me a plan' → weekly targets to keep; kept, they show up on Now",
    status: "ready",
    async run({ api, say }) {
      await api("put", "/now/basics", { wake: "07:00", sleep: "23:30", officeDays: [1, 2, 3, 4, 5], office: { start: "10:00", end: "20:30" } })
      const r = await say("make me a plan to prepare for software interviews in 2 months: DSA, system design and English speaking")
      const gp = r.actions.find((x) => x.type === "GOAL_PLAN")
      const plan = gp?.proposal?.plan
      if (!plan) return `no plan proposed (ai ${gp?.proposal?.aiAvailable}): ${r.reply.slice(0, 120)}`
      if ((plan.targets?.length ?? 0) < 2) return `only ${plan.targets?.length} targets`
      if ((await api("get", "/projects")).body.data?.length) return "something was created before keeping"
      const kept = await api("post", "/goal-plan/accept", { plan })
      if (kept.status !== 201) return `keep returned ${kept.status}`
      const now = await nowAt(api, `${nextWednesday()}T07:30`)
      return now.options?.some((o: any) => o.sourceType === "PROJECT") ? null : `no target session on Now: ${now.message}`
    },
  },
  {
    id: "P7",
    name: "'Meeting till …' pauses suggestions until then",
    status: "ready",
    async run({ api, say }) {
      const ist = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())
      const [h] = ist.split(":").map(Number)
      if (h! >= 22) return null // too late in the day to test "till" safely
      const until = `${h! + 1}:30`
      const r = await say(`in a meeting till ${until}`)
      if (r.usedAi || !r.actions.some((x) => x.type === "BUSY_SET")) return `busy not set by code: ${r.reply}`
      const now = (await api("get", "/now")).body.data
      if (now.kind !== "REST" || !/busy until/i.test(now.message)) return `Now still suggests: ${now.message}`
      const free = await say("I'm free now")
      return free.actions.some((x) => x.type === "BUSY_SET" && x.until === null) ? null : "couldn't clear busy"
    },
  },
  // ---- Phase C: what Ally says on its own, and talking like a person (ADR 0027) ----------
  {
    id: "C1",
    name: "A whole week: briefing at wake, evening nudge, wrap-up before sleep, Sunday review; sick day silent",
    status: "ready",
    async run({ api }) {
      await api("put", "/now/basics", { wake: "07:00", sleep: "00:00", officeDays: [1, 2, 3, 4, 5], office: { start: "10:00", end: "20:30" } })
      const area = await careerId(api)
      const made = await api("post", "/projects", { title: "DSA", areaId: area, kind: "PRACTICE", weeklyTargetMinutes: 360, sessionMinutes: 45, timeBlock: "MORNING" })
      if (made.status !== 201) return `project not created (${made.status})`
      await api("post", "/habits", { title: "Gym", areaId: area, timeBlock: "EVENING", targetMinutes: 45 })
      // Next Monday to Sunday, each looked at from 6 am.
      const monday = (() => {
        for (let i = 1; i <= 7; i++) if (weekdayIst(`${dayKey(i)}T12:00:00+05:30`) === "Monday") return i
        return 1
      })()
      for (let d = 0; d < 7; d++) {
        const key = dayKey(monday + d)
        const r = await api("get", `/now/agenda?at=${key}T06:00`)
        if (r.status !== 200) return `agenda ${key}: HTTP ${r.status}`
        const items = (r.body.data.items as any[]).filter((i) => i.dayKey === key)
        const kinds = items.map((i) => i.kind)
        const weekend = d >= 5
        if (kinds[0] !== "BRIEFING") return `${key}: first is ${kinds[0]}`
        if (!kinds.includes("WRAP_UP")) return `${key}: no wrap-up (${kinds.join(",")})`
        if (!weekend && !/Office 10 am–8:30 pm/.test(items[0].body)) return `${key}: briefing was "${items[0].body}"`
        if (!weekend && !/DSA/.test(items[0].body)) return `${key}: briefing misses the DSA session: "${items[0].body}"`
        if (weekend !== (items[0].title === "Your weekend day")) return `${key}: title "${items[0].title}"`
        if ((d === 6) !== kinds.includes("WEEKLY_REVIEW")) return `${key}: Sunday review ${kinds.includes("WEEKLY_REVIEW") ? "on a weekday" : "missing"}`
        // Nothing in the night (before 7 am or after midnight IST).
        for (const i of items) {
          if (i.atMin < 7 * 60 || i.atMin >= 24 * 60) return `${key}: ${i.kind} at minute ${i.atMin} is in the night`
        }
      }
      await api("put", "/now/mode", { mode: "SICK" })
      const sick = await api("get", `/now/agenda?at=${dayKey(monday)}T06:00`)
      await api("put", "/now/mode", { mode: "NORMAL" })
      return sick.body.data.items.length === 0 ? null : `sick mode still sends ${sick.body.data.items.length} things`
    },
  },
  {
    id: "C2",
    name: "'What's my day?', 'what did I do yesterday?', 'am I on track?' are answered from real data, without AI",
    status: "ready",
    async run({ api, say }) {
      const area = await careerId(api)
      await api("post", "/projects", { title: "DSA", areaId: area, kind: "PRACTICE", weeklyTargetMinutes: 360, sessionMinutes: 45 })
      for (const [q, want] of [
        ["what's my day?", /rest of today|Nothing else planned|sick mode/],
        ["what did I do yesterday?", /Yesterday you did|Nothing logged yesterday/],
        ["am I on track?", /DSA: .* of [\d.]+ h this week/],
      ] as const) {
        const r = await say(q)
        if (r.usedAi) return `"${q}" went to the AI`
        if (!want.test(r.reply)) return `"${q}" → ${r.reply.slice(0, 160)}`
      }
      return null
    },
  },
  // ---- Personas (plan 16 §0: Ally must fit people who are not the founder) ----------------
  // Each is a different life. Pass = a sensible first day with nothing from anyone else's life.
  {
    id: "U1",
    name: "Persona: college student with exams gets a revision plan around classes",
    status: "ready",
    async run({ api, say }) {
      const said = "I'm a B.Com student and my exams start in 6 weeks. Make me a plan to revise accounting, economics and business law."
      // Classes Mon to Sat, 8 to 2.
      const basics = await api("put", "/now/basics", { wake: "06:30", sleep: "23:00", officeDays: [1, 2, 3, 4, 5, 6], office: { start: "08:00", end: "14:00" } })
      if (basics.status !== 200) return `class hours not accepted (${basics.status})`
      const r = await say(said)
      const plan = r.actions.find((x) => x.type === "GOAL_PLAN")?.proposal?.plan
      if (!plan) return `no plan proposed: ${r.reply.slice(0, 120)}`
      const titles = (plan.targets ?? []).map((t: any) => t.title).join(" | ")
      if (!/account|econom|law|revis|mock|paper|practice/i.test(titles)) return `plan is not about their exams: ${titles}`
      if ((plan.targets ?? []).some((t: any) => t.block === "OFFICE")) return "a revision session was put inside class hours"
      const wed = nextWednesday()
      const inClass = await nowAt(api, `${wed}T10:00`)
      if (inClass.block !== "OFFICE") return `10:00 on a class day is ${inClass.block}, expected the fixed block`
      return founderBias(api, [r], said)
    },
  },
  {
    id: "U2",
    name: "Persona: night-shift worker's day is understood (works through the night, sleeps by day)",
    // Known gap, found by this persona: the day model (now.rules.ts normalizeDay) drops any block
    // that crosses midnight, so a 21:00 to 06:00 shift is lost and quiet hours follow the wrong
    // sleep. Flip to "ready" when overnight days are supported (docs/STATUS.md, open risks).
    status: { pendingUntil: 9 },
    async run({ api, say }) {
      const said = "I work night shifts, 9 pm to 6 am, Monday to Friday. I sleep from about 7 am to 2 pm. Remind me to take my vitamin D every day when I wake up."
      const r = await say(said)
      if (/sorry|can't|cannot|unable/i.test(r.reply) && !r.actions.length) return `refused or lost: ${r.reply.slice(0, 120)}`
      const rem = ofType(r, "REMINDER_SET")[0]
      if (!rem?.remindAt) return `no vitamin reminder (reply: ${r.reply.slice(0, 100)})`
      const h = hourIst(rem.remindAt)
      if (h < 13 || h > 16) return `reminder at ${h}:00, they wake around 14:00`
      const wed = nextWednesday()
      const night = await nowAt(api, `${wed}T23:30`)
      if (night.block !== "OFFICE") return `23:30 is mid-shift but Now says ${night.block}`
      return founderBias(api, [r], said)
    },
  },
  {
    id: "U3",
    name: "Persona: stay-at-home parent with a toddler: no office, small windows, weekly call",
    status: "ready",
    async run({ api, say }) {
      const said = "I'm at home with my 2 year old. Nap time, 1 to 3 pm, is my only free time. I want to start a small home bakery and walk every day. Every Sunday remind me to call my mother."
      const basics = await api("put", "/now/basics", { wake: "06:30", sleep: "22:30", officeDays: [], office: null })
      if (basics.status !== 200) return `a day with no job or classes not accepted (${basics.status})`
      const r = await say(said)
      const call = ofType(r, "REMINDER_SET").find((x) => /call|mother|mom/i.test(x.text ?? x.title ?? ""))
      if (!call) return `no call-mother reminder: ${r.reply.slice(0, 120)}`
      if (!/FREQ=WEEKLY/.test(call.repeatRule ?? "") || !/BYDAY=SU/.test(call.repeatRule ?? "")) return `repeat rule ${call.repeatRule}`
      const made = ofType(r, "PROJECT_ADDED").length + ofType(r, "HABIT_ADDED").length + r.actions.filter((x) => x.type === "GOAL_PLAN").length
      if (!made) return `neither the bakery nor the walk was picked up: ${r.reply.slice(0, 120)}`
      const midday = await nowAt(api, `${nextWednesday()}T11:00`)
      if (midday.block === "OFFICE") return "invented working hours for someone who has none"
      return founderBias(api, [r], said)
    },
  },
  {
    id: "U4",
    name: "Persona: freelancer with client deadlines gets two dated jobs, not a life plan",
    status: "ready",
    async run({ api, say }) {
      const said = "I'm a freelance designer. Client logo is due Friday and the website mockup is due next Tuesday. I work best in the mornings."
      const r = await say(said)
      // Either shape is fine for someone who never said "project": a to-do or a project, each with its date.
      const jobs = [
        ...(await taskList(api)).map((t) => ({ title: t.title as string, due: (t.dueDate ?? null) as string | null })),
        ...((await api("get", "/projects")).body.data ?? []).map((p: any) => ({ title: p.title as string, due: (p.deadline ?? null) as string | null })),
      ]
      const logo = jobs.find((j) => /logo/i.test(j.title))
      const mock = jobs.find((j) => /mockup|website/i.test(j.title))
      if (!logo || !mock) return `jobs not saved: ${jobs.map((j) => j.title).join(" | ") || "none"} (reply: ${r.reply.slice(0, 100)})`
      if (!logo.due || !mock.due) return "a client job has no date"
      if (weekdayIst(`${logo.due.slice(0, 10)}T12:00:00+05:30`) !== "Friday") return `logo due ${logo.due} is not a Friday`
      if (weekdayIst(`${mock.due.slice(0, 10)}T12:00:00+05:30`) !== "Tuesday") return `mockup due ${mock.due} is not a Tuesday`
      if (questions(r.reply) > 1) return "asked more than one question"
      return founderBias(api, [r], said)
    },
  },
  {
    id: "U6",
    name: "Dials: 'be more direct' and 'I only want reminders' are set by code, stored, and undoable",
    status: "ready",
    async run({ api, say }) {
      const d = await say("be more direct with me")
      if (d.usedAi || !d.actions.some((x) => x.type === "PREFERENCE_SET")) return `direct not set by code (usedAi ${d.usedAi}): ${d.reply}`
      const f = await say("I only want reminders")
      if (f.usedAi || !f.actions.some((x) => x.type === "PREFERENCE_SET")) return `focus not set by code (usedAi ${f.usedAi}): ${f.reply}`
      const s = (await api("get", "/settings")).body.data
      if (s.directness !== "DIRECT" || s.focus !== "REMEMBER") return `stored ${s.directness} / ${s.focus}`
      const undone = await api("post", `/activity/${f.actions.find((x) => x.type === "PREFERENCE_SET")!.activityId}/undo`)
      if (undone.status !== 200) return `undo returned ${undone.status}`
      const after = (await api("get", "/settings")).body.data
      if (after.focus !== "ALL" || after.directness !== "DIRECT") return `after undo ${after.directness} / ${after.focus}, expected DIRECT / ALL`
      // A real request is not mistaken for a setting.
      const r = await say("remind me to call the plumber tomorrow at 11")
      return r.actions.some((x) => x.type === "REMINDER_SET") ? null : `a reminder request was swallowed: ${r.reply.slice(0, 80)}`
    },
  },
  {
    id: "U7",
    name: "Custom moods: a save kept for 'before an exam' or 'bored' (not in the fixed list) comes back when they say so",
    status: "ready",
    async run({ api, say }) {
      const calm = await api("post", "/guide/saves", { text: "https://www.instagram.com/reel/Cexam01/ 5 minute breathing routine to calm your nerves before a big test or interview" })
      const fun = await api("post", "/guide/saves", { text: "https://www.instagram.com/reel/Cfun002/ the funniest cat compilation you will see this week" })
      if (calm.status !== 201 || fun.status !== 201) return `save returned ${calm.status}/${fun.status}`
      // Their own words, not the fixed list; one even typed as a sentence.
      const a = await api("post", `/guide/saves/${calm.body.data.id}/moods`, { moods: ["before an exam"] })
      const b = await api("post", `/guide/saves/${fun.body.data.id}/moods`, { moods: ["When I'm bored"] })
      if (a.status !== 200 || b.status !== 200) return `moods returned ${a.status}/${b.status}: ${a.body?.message ?? ""} ${b.body?.message ?? ""}`
      if (!b.body.data.shelved || b.body.data.proposal.feelings[0] !== "bored") return `second save kept as ${JSON.stringify(b.body.data.proposal.feelings)}, shelved ${b.body.data.shelved}`
      const list = (await api("get", "/guide/saves/moods")).body.data
      if (!list.mine.includes("before an exam") || !list.mine.includes("bored")) return `own moods not listed: ${JSON.stringify(list)}`
      if (!list.suggested.includes("tired")) return "common moods missing"
      // Saying it brings the right one back, found by code.
      const r1 = await say("I'm bored")
      const s1 = r1.actions.find((x) => x.type === "COMFORT_SHOWN")
      if (!s1 || !/cat/i.test(s1.item?.title ?? "")) return `"I'm bored" brought back ${s1?.item?.title ?? "nothing"}`
      const r2 = await say("show me something for before an exam")
      const s2 = r2.actions.find((x) => x.type === "COMFORT_SHOWN")
      if (!s2 || /cat/i.test(s2.item?.title ?? "")) return `"before an exam" brought back ${s2?.item?.title ?? "nothing"}`
      // Ordinary talk that mentions a mood word does not fire it.
      const r3 = await say("remind me to buy the bored game for my nephew tomorrow at 6")
      if (r3.actions.some((x) => x.type === "COMFORT_SHOWN")) return "a reminder was taken for a mood"
      // A fixed word still works as before, and a stranger's label is not invented.
      const r4 = await say("I'm feeling lonely")
      return r4.actions.some((x) => x.type === "COMFORT_SHOWN" && x.feeling === "bored") ? "lonely brought back a bored save" : null
    },
  },
  {
    id: "M1",
    name: "Chat manages things: remove (archive), which-one, over-3 asks, pause, rename, bring back, all with Undo",
    status: "ready",
    async run({ api, say, db, userId }) {
      const area = await careerId(api)
      const habit = async (title: string) => (await api("post", "/habits", { title, areaId: area })).body.data.id as string
      const gym = await habit("Gym session")
      const water = await habit("Drink water")
      await habit("Read 10 pages")
      await api("post", "/tasks", { title: "Pack gym bag", areaId: area })
      const passport = (await api("post", "/tasks", { title: "Renew passport", areaId: area })).body.data.id as string
      const guitar = (await api("post", "/projects", { title: "Learn guitar", areaId: area, kind: "PRACTICE", weeklyTargetMinutes: 120 })).body.data.id as string
      await db.allyNote.create({ data: { userId, collection: "Breakfast", template: "LIST", title: "Breakfast options", items: ["poha", "oats"] } })
      const active = async (id: string) => (await db.habit.findUnique({ where: { id } }))?.isActive
      const noAi = (r: ChatReplyShape, what: string) => (r.usedAi ? `${what}: used the AI` : null)

      // 1. Remove by name = archive, by code, with Undo.
      const d = await say("delete my water habit")
      if (noAi(d, "remove")) return noAi(d, "remove")
      const rm = d.actions.find((x) => x.type === "ITEM_REMOVED")
      if (!rm?.activityId) return `water habit not removed with an undo: ${d.reply}`
      if (await active(water)) return "water habit is still active"
      if ((await api("post", `/activity/${rm.activityId}/undo`)).status !== 200) return "undo failed"
      if (!(await active(water))) return "undo did not bring the water habit back"

      // 2. A name that fits two things asks which one; the chosen option works as typed.
      const q = await say("remove gym")
      const ask = q.actions.find((x) => x.type === "ASK")
      if (!ask || (ask.options?.length ?? 0) !== 2) return `expected a which-one question with 2 choices: ${JSON.stringify(q.actions.map((x) => x.type))} ${q.reply}`
      if (!(await active(gym))) return "something was removed before they chose"
      const choice = ask.options!.find((o) => /habit/i.test(o.title))!
      const picked = await say(choice.title)
      if (!picked.actions.some((x) => x.type === "ITEM_REMOVED") || (await active(gym))) return `choosing "${choice.title}" did not remove the habit: ${picked.reply}`

      // 3. Bring it back by saying so.
      const back = await say("bring back my gym habit")
      if (!back.actions.some((x) => x.type === "UNDONE") || !(await active(gym))) return `gym habit not brought back: ${back.reply}`

      // 4. Rename, and its undo.
      const rn = await say("rename passport to renew my passport")
      const ru = rn.actions.find((x) => x.type === "ITEM_UPDATED")
      if (!ru?.activityId || (await db.task.findUnique({ where: { id: passport } }))?.title !== "renew my passport") return `rename failed: ${rn.reply}`
      await api("post", `/activity/${ru.activityId}/undo`)
      if ((await db.task.findUnique({ where: { id: passport } }))?.title !== "Renew passport") return "rename undo did not restore the title"

      // 5. Pause and resume a goal.
      await say("pause the guitar goal")
      if ((await db.project.findUnique({ where: { id: guitar } }))?.status !== "PAUSED") return "goal not paused"
      await say("resume guitar")
      if ((await db.project.findUnique({ where: { id: guitar } }))?.status !== "ACTIVE") return "goal not resumed"

      // 6. A note is removed and comes back.
      await say("delete the breakfast note")
      if (await db.allyNote.count({ where: { userId } })) return "note not removed"
      await say("bring back the breakfast note")
      if ((await db.allyNote.count({ where: { userId, title: "Breakfast options" } })) !== 1) return "note not brought back"

      // 7. More than 3 asks first and removes nothing; the yes does the whole job.
      await habit("Meditate")
      await habit("Stretch")
      const total = await db.habit.count({ where: { userId, isActive: true } })
      const big = await say("delete all my habits")
      const confirm = big.actions.find((x) => x.type === "ASK")?.options?.find((o) => /^yes/i.test(o.title))
      if (!confirm || (await db.habit.count({ where: { userId, isActive: true } })) !== total) return `bulk delete did not wait for a yes: ${big.reply}`
      await say(confirm.title)
      if (await db.habit.count({ where: { userId, isActive: true } })) return "the yes did not remove every habit"
      const keep = await say("No, keep them")
      if (keep.actions.some((x) => x.type === "ITEM_REMOVED")) return "'no' removed something"

      // 8. Things that must never happen.
      const acct = await say("delete my account")
      if (acct.actions.length || !/Account and data/i.test(acct.reply) || !(await db.user.findUnique({ where: { id: userId } }))) return `"delete my account" was not refused properly: ${acct.reply}`
      const miss = await say("delete my ballet habit")
      if (miss.actions.some((x) => x.type === "ITEM_REMOVED") || !/can't find/i.test(miss.reply)) return `unknown name: ${miss.reply}`
      return null
    },
  },
  {
    id: "M2",
    name: "Chat edits by name: time, size, priority, day, deadline, habit days; areas; Quieter / Silent. Each undoable",
    status: "ready",
    async run({ api, say, db, userId }) {
      const area = await careerId(api)
      const gym = (await api("post", "/habits", { title: "Gym session", areaId: area })).body.data.id as string
      const passport = (await api("post", "/tasks", { title: "Renew passport", areaId: area })).body.data.id as string
      const guitar = (await api("post", "/projects", { title: "Learn guitar", areaId: area, kind: "PRACTICE", weeklyTargetMinutes: 120 })).body.data.id as string
      const noAi = (r: ChatReplyShape, what: string) => (r.usedAi ? `${what}: used the AI` : null)
      const undo = async (r: ChatReplyShape) => (await api("post", `/activity/${r.actions.find((x) => x.activityId)?.activityId}/undo`)).status
      const habit = () => db.habit.findUnique({ where: { id: gym } })
      const task = () => db.task.findUnique({ where: { id: passport } })
      const project = () => db.project.findUnique({ where: { id: guitar } })

      // Time of a habit, and its undo.
      let r = await say("set the gym habit to 7 am")
      if (noAi(r, "habit time")) return noAi(r, "habit time")
      if ((await habit())?.reminderTime !== "07:00") return `habit time is ${(await habit())?.reminderTime}: ${r.reply}`
      if ((await undo(r)) !== 200 || (await habit())?.reminderTime) return "habit time undo did not clear it"

      // Size, priority, and moving a to-do to a day.
      r = await say("make passport 45 min")
      if ((await task())?.sizeMinutes !== 45) return `size is ${(await task())?.sizeMinutes}: ${r.reply}`
      r = await say("make passport high priority")
      if ((await task())?.priority !== "HIGH") return `priority is ${(await task())?.priority}: ${r.reply}`
      if ((await undo(r)) !== 200 || (await task())?.priority !== "MEDIUM") return "priority undo failed"
      r = await say("move passport to friday")
      if (!(await task())?.dueDate || (await task())!.dueDate!.getUTCDay() !== 5) return `due ${(await task())?.dueDate}: ${r.reply}`

      // A goal's deadline and session length.
      r = await say("set the guitar deadline to 30 nov")
      const dl = (await project())?.deadline
      if (!dl || dl.getUTCMonth() !== 10 || dl.getUTCDate() !== 30) return `deadline ${dl}: ${r.reply}`
      r = await say("make guitar sessions 25 min")
      if ((await project())?.sessionMinutes !== 25) return `session ${(await project())?.sessionMinutes}: ${r.reply}`

      // Days of a habit.
      r = await say("set the gym habit to mon wed fri")
      const h = await habit()
      if (h?.frequency !== "CUSTOM" || [...(h?.specificDays ?? [])].sort().join() !== "FRI,MON,WED") return `days ${h?.frequency} ${h?.specificDays}: ${r.reply}`
      if ((await undo(r)) !== 200 || (await habit())?.frequency !== "DAILY") return "days undo failed"

      // A name that fits two things asks; the chosen option works as typed.
      await api("post", "/tasks", { title: "Pack gym bag", areaId: area })
      r = await say("set gym to 6 pm")
      const q = r.actions.find((x) => x.type === "ASK")
      if (!q || (q.options?.length ?? 0) !== 2) return `expected a which-one question: ${r.reply}`
      const pick = q.options!.find((o) => /habit/i.test(o.title))!
      await say(pick.title)
      if ((await habit())?.reminderTime !== "18:00") return `chosen option did not set the habit: ${(await habit())?.reminderTime}`

      // Areas: add, rename, change tier; making a second area Main asks first and demotes the old one.
      r = await say("add an area called Music")
      if (noAi(r, "add area")) return noAi(r, "add area")
      const music = await db.area.findFirst({ where: { userId, name: "Music" } })
      if (!music || music.tier !== "MAINTAIN") return `area not added: ${r.reply}`
      await say("rename area music to Guitar and music")
      if ((await db.area.findUnique({ where: { id: music.id } }))?.name !== "Guitar and music") return "area not renamed"
      await say("make music secondary")
      if ((await db.area.findUnique({ where: { id: music.id } }))?.tier !== "SECONDARY") return "area tier not set"
      r = await say("make music my main area")
      const confirm = r.actions.find((x) => x.type === "ASK")?.options?.find((o) => /^yes/i.test(o.title))
      if (!confirm || (await db.area.findUnique({ where: { id: area } }))?.tier !== "MAIN") return `making a second Main did not ask first: ${r.reply}`
      r = await say(confirm.title)
      if ((await db.area.findUnique({ where: { id: music.id } }))?.tier !== "MAIN" || (await db.area.findUnique({ where: { id: area } }))?.tier !== "SECONDARY") return "the yes did not swap Main"
      if ((await undo(r)) !== 200 || (await db.area.findUnique({ where: { id: area } }))?.tier !== "MAIN" || (await db.area.findUnique({ where: { id: music.id } }))?.tier !== "SECONDARY") return "area swap undo failed"

      // How much Ally messages by itself.
      const level = async () => (await db.userSettings.findUnique({ where: { userId } }))?.proactivity
      r = await say("be quieter")
      if (noAi(r, "quieter") || (await level()) !== "QUIETER") return `quieter: ${await level()}`
      r = await say("go silent")
      if ((await level()) !== "SILENT") return `silent: ${await level()}`
      if ((await undo(r)) !== 200 || (await level()) !== "QUIETER") return `silent undo left ${await level()}`
      await say("message me normally")
      if ((await level()) !== "NORMAL") return `normal: ${await level()}`

      // Not about the app: nothing changes.
      r = await say("set my mind to 5 pm")
      if (r.actions.some((x) => x.type === "ITEM_UPDATED")) return "an unrelated sentence changed something"
      return null
    },
  },
  {
    id: "M3",
    name: "Chat shows lists: habits, to-dos, reminders, goals, areas, notes, and what was removed; empty ones say what to do",
    status: "ready",
    async run({ api, say, db, userId }) {
      const area = await careerId(api)
      const list = (r: ChatReplyShape) => r.actions.find((x) => x.type === "LIST")
      const noAi = (r: ChatReplyShape, what: string) => (r.usedAi ? `${what}: used the AI` : null)

      // Empty places say what to do next.
      let r = await say("show my notes")
      if (noAi(r, "empty list") || list(r) || !/Tell me something to keep/i.test(r.reply)) return `empty notes: ${r.reply}`

      const gym = (await api("post", "/habits", { title: "Gym session", areaId: area })).body.data.id as string
      await api("post", "/habits", { title: "Drink water", areaId: area })
      await api("post", "/tasks", { title: "Pack gym bag", areaId: area })
      await api("post", "/tasks", { title: "Renew passport", areaId: area, priority: "HIGH" })
      await db.task.create({ data: { userId, title: "Call mom", remindAt: new Date(Date.now() + 86_400_000), repeatRule: "FREQ=WEEKLY;BYDAY=SU", areaId: area } })
      await api("post", "/projects", { title: "Learn guitar", areaId: area, kind: "PRACTICE", weeklyTargetMinutes: 120 })
      await db.allyNote.create({ data: { userId, collection: "Breakfast", template: "LIST", title: "Breakfast options", items: ["poha", "oats"] } })

      r = await say("show my habits")
      let l = list(r)
      if (noAi(r, "habits") || !l || l.kind !== "HABIT" || l.options!.length !== 2 || !l.options!.every((o) => /every day/.test(o.detail ?? ""))) return `habits list: ${JSON.stringify(l)} ${r.reply}`
      r = await say("what reminders do I have?")
      l = list(r)
      if (!l || (l.options as unknown[]).length !== 1 || !/repeats weekly/.test(l.options![0]!.detail ?? "")) return `reminders list: ${JSON.stringify(l)}`
      r = await say("list my to-dos")
      l = list(r)
      if (!l || l.options!.length !== 2 || l.options!.some((o) => /Call mom/.test(o.title))) return `to-dos should hold 2 and not the reminder: ${JSON.stringify(l?.options?.map((o) => o.title))}`
      if (!l.options!.some((o) => /high priority/.test(o.detail ?? ""))) return "priority not shown"
      r = await say("what are my goals")
      if (list(r)?.options?.[0]?.title !== "Learn guitar") return `goals list: ${JSON.stringify(list(r))}`
      r = await say("show my areas")
      if (!list(r)?.options?.some((o) => o.title === "Career" && o.detail === "Main")) return `areas list: ${JSON.stringify(list(r))}`
      r = await say("show my notes")
      if (!/Breakfast/.test(list(r)?.options?.[0]?.detail ?? "")) return `notes list: ${JSON.stringify(list(r))}`

      // Removed things are listed, and the row's command brings it back.
      await say("delete my gym habit")
      r = await say("what did I remove?")
      l = list(r)
      const row = l?.options?.find((o) => o.title === "Gym session")
      if (!l || l.kind !== "REMOVED" || !row || row.kind !== "HABIT") return `removed list: ${JSON.stringify(l)}`
      r = await say("Bring back habit: Gym session")
      if (!r.actions.some((x) => x.type === "UNDONE") || !(await db.habit.findUnique({ where: { id: gym } }))?.isActive) return `bring back from the list failed: ${r.reply}`

      // The which-one question's options are commands, so the phone sends them as written.
      r = await say("remove gym")
      const ask = r.actions.find((x) => x.type === "ASK")
      if (!ask || !ask.options!.length || !ask.options!.every((o) => o.command === true)) return `ask options are not marked as commands: ${JSON.stringify(ask?.options)}`

      // A long list shows the first 15 and says so.
      for (let i = 1; i <= 16; i++) await api("post", "/tasks", { title: `Chore number ${i}`, areaId: area })
      r = await say("show my to-dos")
      l = list(r)
      if (!l || (l.options as unknown[]).length !== 15 || (l.total ?? 0) < 18 || !/first 15/.test(r.reply)) return `long list: ${l?.options?.length} of ${l?.total}: ${r.reply}`

      // Sentences that merely mention a list are left to the AI's search.
      r = await say("show me notes about breakfast")
      if (list(r)) return "a search was taken for a list"
      return null
    },
  },
  {
    id: "M4",
    name: "Parity: the Now card, too-much-today, prep, low energy, memory privacy and account buttons each have a working chat phrase",
    status: "ready",
    async run({ api, say, db, userId }) {
      // A free day with no office, so Now always has something to show whatever the clock says.
      await api("put", "/now/basics", { wake: "00:30", sleep: "23:59", officeDays: [], office: null })
      const area = await careerId(api)
      const gym = (await api("post", "/habits", { title: "Gym session", areaId: area })).body.data.id as string
      await api("post", "/habits", { title: "Oats breakfast", areaId: area, prepareAhead: "soak the oats", prepTime: "21:30" })
      const passport = (await api("post", "/tasks", { title: "Renew passport", areaId: area, priority: "HIGH", dueDate: dayKey(0) })).body.data.id as string
      await db.memory.create({ data: { userId, content: "Likes ginger tea in the evening", kind: "PREFERENCE", importance: 2, source: "SAID", sensitive: false } })

      const failures: string[] = []
      const row = async (name: string, fn: () => Promise<string | null>) => {
        try {
          const why = await fn()
          if (why) failures.push(`${name}: ${why}`)
        } catch (e) {
          failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      const events = (type: string, itemType: string, itemId?: string) => db.activityEvent.count({ where: { userId, type: type as "SKIPPED", itemType: itemType as "TASK", undoneAt: null, ...(itemId && { itemId }) } })

      await row("Now: Not now", async () => {
        const r = await say("not now")
        const a = r.actions.find((x) => x.type === "ITEM_UPDATED")
        if (r.usedAi || !a || !a.activityId) return `no skip receipt: ${r.reply}`
        return (await events("SKIPPED", a.itemType ?? "TASK", a.id)) ? null : "the skip was not recorded"
      })
      await row("Now: Make it smaller", async () => {
        const r = await say("make it smaller")
        return r.usedAi || !r.actions.some((x) => x.type === "NOW_PICK") ? `no card: ${r.reply}` : null
      })
      await row("Plan/Now: skip a named habit", async () => {
        const r = await say("skip gym today")
        if (r.usedAi) return "used the AI"
        return (await events("SKIPPED", "HABIT", gym)) ? null : `not recorded: ${r.reply}`
      })
      await row("Now: Smaller (count the minimum)", async () => {
        const r = await say("I only did 10 minutes of gym")
        if (r.usedAi) return "used the AI"
        return (await events("MINIMUM", "HABIT", gym)) ? null : `not recorded: ${r.reply}`
      })
      await row("Now: Done (a to-do, by name)", async () => {
        await say("done with Renew passport")
        return (await db.task.findUnique({ where: { id: passport } }))?.status === "COMPLETED" ? null : "to-do not completed"
      })
      await row("Too much today: move the extra to later", async () => {
        for (let i = 1; i <= 5; i++) await api("post", "/tasks", { title: `Big job ${i}`, areaId: area, sizeMinutes: 300, dueDate: dayKey(0) })
        const r = await say("move the extra stuff to later")
        const moved = r.actions.find((x) => x.type === "ITEM_UPDATED" && /later/.test(x.detail ?? ""))
        if (r.usedAi || !moved?.activityId) return `nothing moved: ${r.reply}`
        const left = await db.task.count({ where: { userId, title: { startsWith: "Big job" }, dueDate: { not: null } } })
        return left < 5 ? null : "every job kept today's date"
      })
      await row("Tonight's prep: done", async () => {
        const r = await say("I prepped the oats")
        const a = r.actions.find((x) => x.type === "ITEM_UPDATED" && /prep done/.test(x.detail ?? ""))
        return r.usedAi || !a ? `prep not marked: ${r.reply}` : (await db.activityEvent.count({ where: { userId, reason: "PREP" } })) ? null : "prep not recorded"
      })
      await row("Now: Low energy today", async () => {
        const r = await say("low energy today")
        const a = r.actions.find((x) => x.type === "LOW_ENERGY")
        return r.usedAi || a?.kind !== "ON" ? `no low-energy action: ${r.reply}` : null
      })
      await row("Memories: make private, and undo", async () => {
        const r = await say("make my ginger tea memory private")
        const a = r.actions.find((x) => x.type === "ITEM_UPDATED" && x.itemType === "MEMORY")
        if (r.usedAi || !a?.activityId) return `not marked: ${r.reply}`
        if (!(await db.memory.findFirst({ where: { userId, content: { contains: "ginger" } } }))?.sensitive) return "memory is not private"
        if ((await api("post", `/activity/${a.activityId}/undo`)).status !== 200) return "undo failed"
        return (await db.memory.findFirst({ where: { userId, content: { contains: "ginger" } } }))?.sensitive ? "undo left it private" : null
      })
      await row("You: Sign out / export are pointed to, never done", async () => {
        const out = await say("sign me out")
        const exp = await say("export my data")
        if (out.actions.length || exp.actions.length) return `took an action: ${out.actions.map((x) => x.type)} ${exp.actions.map((x) => x.type)}`
        if (!/Sign out/.test(out.reply) || !/Account and data/.test(exp.reply)) return `no pointer: ${out.reply} / ${exp.reply}`
        return (await db.userSettings.findUnique({ where: { userId } }))?.nightlyTime ? "a nudge setting was changed" : null
      })
      return failures.length ? `${failures.length} of 10 parity rows failed: ${failures.join(" | ")}` : null
    },
  },
  {
    id: "K1",
    name: "Get to know you: one question at a time, 2 a day, answers set the day and settings, skips rest, no AI",
    status: "ready",
    async run({ api, db, userId }) {
      const next = async () => (await api("get", "/know")).body.data as { question: { id: string; options: string[] } | null; answered: number; total: number }
      const answer = (id: string, a: string) => api("post", "/know", { id, answer: a })
      // Pretend a day has passed: the daily cap counts today's questions only.
      const nextDay = () => db.activityEvent.updateMany({ where: { userId, title: { startsWith: "know:" } }, data: { at: ago(1) } })

      let q = await next()
      if (q.question?.id !== "goal" || q.total !== 10 || q.answered !== 0) return `first question: ${JSON.stringify(q)}`

      const g = await answer("goal", "switch to a better job")
      if (g.status !== 200 || !/make me a plan/.test(g.body.data.message)) return `goal answer: ${JSON.stringify(g.body)}`
      if (!(await db.memory.findFirst({ where: { userId, kind: "GOAL", content: { contains: "better job" } } }))) return "goal not remembered"

      q = await next()
      if (q.question?.id !== "wake") return `second question ${q.question?.id}`
      const w = await answer("wake", "6 to 7")
      if (/days are set/.test(w.body.data.message)) return "set the day from the wake time alone"
      q = await next()
      if (q.question !== null) return `a third question today: ${q.question.id}`

      await nextDay()
      q = await next()
      if (q.question?.id !== "sleep" || q.answered !== 2) return `next day: ${JSON.stringify(q)}`
      const s = await answer("sleep", "11 to 12")
      if (!/up at 6:30 am/.test(s.body.data.message) || !/bed around 11:30 pm/.test(s.body.data.message)) return `day not set: ${s.body.data.message}`
      if ((await db.daySchedule.count({ where: { userId } })) !== 7) return "the week was not built"

      // A reply that can't be read is asked again, and nothing is recorded.
      const before = await db.activityEvent.count({ where: { userId, title: "know:hours" } })
      const bad = await answer("hours", "all day")
      if (!bad.body.data.retry || (await db.activityEvent.count({ where: { userId, title: "know:hours" } })) !== before) return `bad hours: ${JSON.stringify(bad.body)}`

      await nextDay()
      const h = await answer("hours", "10 to 6")
      if (!/work 10 am to 6 pm/.test(h.body.data.message)) return `hours: ${h.body.data.message}`
      const monday = (await db.daySchedule.findFirst({ where: { userId, weekday: 1 } }))!.blocks as { block: string; start: string; end: string }[]
      const sunday = (await db.daySchedule.findFirst({ where: { userId, weekday: 0 } }))!.blocks as { block: string }[]
      if (!monday.some((b) => b.block === "OFFICE" && b.start === "10:00" && b.end === "18:00")) return `weekday has no 10 to 6: ${JSON.stringify(monday)}`
      if (sunday.some((b) => b.block === "OFFICE")) return "Sunday got office hours"

      // Skipping rests the question; the next one comes instead.
      await nextDay()
      await api("post", "/know", { id: "drain", skip: true })
      await answer("style", "Direct")
      const st = await db.userSettings.findUnique({ where: { userId } })
      if (st?.directness !== "DIRECT") return `style not applied: ${st?.directness}`
      await nextDay()
      q = await next()
      if (q.question?.id === "drain") return "a skipped question came straight back"
      await answer("help", "My goals")
      if ((await db.userSettings.findUnique({ where: { userId } }))?.focus !== "GOALS") return "help not applied"
      return null
    },
  },
  {
    id: "K2",
    name: "Get to know you: never asks what is already known, and stays quiet when sick",
    status: "ready",
    async run({ api, db, userId }) {
      const next = async () => (await api("get", "/know")).body.data.question as { id: string } | null
      const nextDay = () => db.activityEvent.updateMany({ where: { userId, title: { startsWith: "know:" } }, data: { at: ago(1) } })
      // The day was already set another way (the first-run form, or chat).
      await api("put", "/now/basics", { wake: "07:00", sleep: "23:30", officeDays: [1, 2, 3, 4, 5], office: { start: "10:00", end: "20:30" } })
      await api("put", "/now/mode", { mode: "SICK" })
      if ((await next()) !== null) return "asked a question while sick"
      await api("put", "/now/mode", { mode: "NORMAL" })

      const seen: string[] = []
      for (let i = 0; i < 12; i++) {
        const q = await next()
        if (!q) {
          await nextDay()
          if (!(await next())) break
          continue
        }
        seen.push(q.id)
        await api("post", "/know", { id: q.id, skip: true })
        // A skipped question rests, so the list moves on.
      }
      if (["wake", "sleep", "hours"].some((id) => seen.includes(id))) return `asked what was already known: ${seen.join(", ")}`
      if (!seen.includes("goal")) return `never got to the goal question: ${seen.join(", ")}`
      return null
    },
  },
  {
    id: "U5",
    name: "Persona: reminders only. Three reminders kept, no goals, projects or habits pushed on them",
    status: "ready",
    async run({ api, say }) {
      const said = "remind me to pay the electricity bill on the 5th, take my BP tablet every morning at 8, and call the plumber tomorrow at 11"
      const r = await say(said)
      const rems = ofType(r, "REMINDER_SET")
      if (rems.length !== 3) return `${rems.length} reminders, expected 3 (reply: ${r.reply.slice(0, 100)})`
      const bp = rems.find((x) => /bp|tablet/i.test(x.text ?? x.title ?? ""))
      if (!bp || !/FREQ=DAILY/.test(bp.repeatRule ?? "")) return `tablet reminder repeat is ${bp?.repeatRule}`
      if (hourIst(bp.remindAt!) !== 8) return `tablet at ${hourIst(bp.remindAt!)}:00, expected 8:00`
      if (r.actions.some((x) => ["PROJECT_ADDED", "GOAL_PLAN", "HABIT_ADDED"].includes(x.type))) return "made a goal, project or habit out of plain reminders"
      if (questions(r.reply) > 1) return "asked more than one question"
      if ((await api("get", "/projects")).body.data?.length) return "a project exists for a reminders-only person"
      // With no goals at all, Now must not invent any.
      const now = await nowAt(api, `${nextWednesday()}T11:00`)
      if (now.options?.some((o: any) => o.sourceType === "PROJECT")) return "Now suggested a goal they never set"
      return founderBias(api, [r], said)
    },
  },
  {
    id: "L1",
    name: "Counts and Log: +1 water, spending, sleep, weight, questions by code, Undo, no AI",
    status: "ready",
    async run({ api, say, db, userId }) {
      const area = await careerId(api)
      const hid = (await api("post", "/habits", { title: "Drink 8 glasses of water", areaId: area, habitType: "COUNT", targetCount: 8 })).body.data.id as string
      const count = async () => (await db.habitLog.findFirst({ where: { habitId: hid }, orderBy: { date: "desc" } }))?.count ?? 0
      const noAi = (r: ChatReplyShape, what: string) => (r.usedAi ? `${what}: used the AI (${r.reply.slice(0, 80)})` : null)
      const undo = async (r: ChatReplyShape) => (await api("post", `/activity/${r.actions[0]!.activityId}/undo`)).status

      // Counts add to today's number on the matching count habit.
      const a = await say("+1 water")
      if (noAi(a, "+1")) return noAi(a, "+1")
      if (!ofType(a, "COUNT_ADDED").length || (await count()) !== 1 || !/1 of 8/.test(a.reply)) return `+1 water: ${a.reply}`
      const b = await say("drank 3 glasses of water")
      if (noAi(b, "drank 3")) return noAi(b, "drank 3")
      if ((await count()) !== 4 || !/4 of 8/.test(b.reply)) return `drank 3: count ${await count()}: ${b.reply}`
      if ((await undo(b)) !== 200 || (await count()) !== 1) return `count undo left ${await count()}`

      // Spending: written, totalled by month, grouped by what it was for.
      const l = await say("spent 250 on lunch")
      if (noAi(l, "spend")) return noAi(l, "spend")
      if (!ofType(l, "LOG_ADDED").length || !/₹250 for lunch/.test(l.reply)) return `spend: ${l.reply}`
      const u = await say("paid 120 for uber")
      if (!/₹370 this month/.test(u.reply)) return `month total: ${u.reply}`
      const q = await say("how much did I spend this month?")
      if (noAi(q, "spend question")) return noAi(q, "spend question")
      if (!/₹370/.test(q.reply) || !/food/.test(q.reply) || !/transport/.test(q.reply)) return `spend answer: ${q.reply}`
      const food = await say("how much did I spend on food this month")
      if (!/₹250/.test(food.reply)) return `food answer: ${food.reply}`
      if ((await undo(u)) !== 200) return "spend undo failed"
      if ((await db.logEntry.count({ where: { userId, series: "money" } })) !== 1) return "undo did not remove the entry"

      // Time is not money: this goes to the weekly-target / AI path, never to the Log.
      const t = await say("spent 2 hours on DSA")
      if (ofType(t, "LOG_ADDED").length) return "hours were logged as money"

      // Sleep and weight: the latest of the day wins, answered plainly.
      await say("slept 5 hours")
      const sl = await say("slept 7 hours")
      if (!ofType(sl, "LOG_ADDED").length) return `sleep: ${sl.reply}`
      const sa = await say("how did I sleep this week?")
      if (noAi(sa, "sleep question")) return noAi(sa, "sleep question")
      if (!/7 h/.test(sa.reply) || /\b5\b/.test(sa.reply)) return `sleep answer should use the latest (7): ${sa.reply}`
      const w = await say("weight 74.5")
      if (!ofType(w, "LOG_ADDED").length) return `weight: ${w.reply}`
      const wa = await say("what's my weight?")
      if (!/74\.5 kg/.test(wa.reply)) return `weight answer: ${wa.reply}`
      if (/streak|fail|lazy|behind|should/i.test([sa.reply, wa.reply, q.reply].join(" "))) return "judging wording in an answer"

      // A count with no matching habit is not guessed: the AI or an ask decides.
      const none = await say("+1 meditation")
      if (ofType(none, "COUNT_ADDED").length) return "counted something with no count habit"
      return null
    },
  },
  {
    id: "L2",
    name: "Limits: set by chat, time and counts added, days kept (never a streak), hidden from Now / habits, Undo, no AI",
    status: "ready",
    async run({ api, say, db, userId }) {
      const noAi = (r: ChatReplyShape, what: string) => (r.usedAi ? `${what}: used the AI (${r.reply.slice(0, 80)})` : null)
      const limit = async (title: string) => db.habit.findFirst({ where: { userId, title, isLimit: true } })

      // Setting limits.
      const a = await say("limit Instagram to 1 hour")
      if (noAi(a, "limit")) return noAi(a, "limit")
      const ig = await limit("Instagram")
      if (!ofType(a, "LIMIT_SET").length || !ig || ig.habitType !== "TIMER" || ig.targetMinutes !== 60 || ig.reminderTime) return `time limit: ${JSON.stringify(ig)} / ${a.reply}`
      const b = await say("no sugar")
      const sugar = await limit("Sugar")
      if (noAi(b, "no sugar")) return noAi(b, "no sugar")
      if (!sugar || sugar.habitType !== "COUNT" || sugar.targetCount !== 0) return `never limit: ${JSON.stringify(sugar)} / ${b.reply}`
      if (/streak|fail|lazy|behind|should/i.test(a.reply + b.reply)) return "judging wording when setting a limit"

      // Using some: under, then past the cap.
      const u1 = await say("spent 40 min on instagram")
      if (noAi(u1, "usage")) return noAi(u1, "usage")
      if (!ofType(u1, "LIMIT_USED").length || !/40 min of 1 h today, 20 min left/.test(u1.reply)) return `under the cap: ${u1.reply}`
      const u2 = await say("scrolled instagram for 30 min")
      if (!/1 h 10 min today, past your 1 h/.test(u2.reply) || !/Tomorrow starts fresh/.test(u2.reply)) return `past the cap: ${u2.reply}`
      if (/streak|fail|lazy|shame|behind|should/i.test(u1.reply + u2.reply)) return "judging wording after using a limit"

      // A count limit, and the questions.
      const c = await say("+1 sugar")
      if (!ofType(c, "COUNT_ADDED").length || !/Sugar: 1 today/.test(c.reply)) return `count on a never-limit: ${c.reply}`
      const q = await say("how's my instagram limit?")
      if (noAi(q, "question")) return noAi(q, "question")
      if (!/1 h 10 min today/.test(q.reply)) return `instagram question: ${q.reply}`
      const all = await say("show my limits")
      if (!/Instagram/.test(all.reply) || !/Sugar/.test(all.reply)) return `all limits: ${all.reply}`

      // Time that does not belong to a limit is left alone.
      const dsa = await say("spent 2 hours on DSA")
      if (ofType(dsa, "LIMIT_USED").length) return "time on something else was added to a limit"

      // Limits are rules, not things to do: not in the habits list, not at Now, never counted as done.
      const habits = ((await api("get", "/habits")).body.data ?? []) as { title: string }[]
      const names = (Array.isArray(habits) ? habits : (habits as any).items ?? []).map((h: any) => h.title)
      if (names.includes("Instagram") || names.includes("Sugar")) return `limits are in the habits list: ${names.join(", ")}`
      const now = await nowAt(api, new Date().toISOString().slice(0, 16))
      if (JSON.stringify(now?.options ?? []).match(/Instagram|Sugar/)) return `Now offered a limit: ${JSON.stringify(now.options).slice(0, 120)}`
      if ((await db.habitLog.count({ where: { userId, completed: true } })) !== 0) return "a limit log counted as completed"

      // Undo and removing by chat.
      if ((await api("post", `/activity/${b.actions[0]!.activityId}/undo`)).status !== 200) return "undo failed"
      if ((await limit("Sugar"))?.isActive !== false) return "undo did not remove the limit"
      const rm = await say("remove my instagram limit")
      if (!ofType(rm, "ITEM_REMOVED").length || (await limit("Instagram"))?.isActive !== false) return `remove by chat: ${rm.reply}`
      return null
    },
  },
  {
    id: "L3",
    name: "Time tracking: start / stop by chat, counts toward a weekly goal once, forgotten timers asked about, where time went, Undo, no AI",
    status: "ready",
    async run({ api, say, db, userId }) {
      const noAi = (r: ChatReplyShape, what: string) => (r.usedAi ? `${what}: used the AI (${r.reply.slice(0, 80)})` : null)
      const area = await careerId(api)
      const dsa = await api("post", "/projects", { title: "DSA practice", areaId: area, kind: "PRACTICE", weeklyTargetMinutes: 360, sessionMinutes: 45, timeBlock: "MORNING" })
      if (dsa.status !== 201) return `project not created (${dsa.status})`
      const pid = dsa.body.data.id as string
      const runningEntry = () => db.timeEntry.findFirst({ where: { userId, endedAt: null } })
      const back = async (minutes: number) => db.timeEntry.updateMany({ where: { userId, endedAt: null }, data: { startedAt: new Date(Date.now() - minutes * 60_000) } })
      const projectMinutes = async () => (await db.activityEvent.findMany({ where: { userId, type: "LOGGED", itemType: "PROJECT", itemId: pid, undoneAt: null } })).reduce((s, e) => s + (e.minutes ?? 0), 0)

      // Start on a goal, 45 minutes pass, stop: the minutes count toward the week once.
      const s1 = await say("start timer for DSA")
      if (noAi(s1, "start")) return noAi(s1, "start")
      const e1 = await runningEntry()
      if (!ofType(s1, "TIMER_STARTED").length || e1?.itemType !== "PROJECT" || e1.itemId !== pid) return `start on a goal: ${JSON.stringify(e1)} / ${s1.reply}`
      await back(45)
      const st = await say("how long has it been?")
      if (!/45 min so far/.test(st.reply)) return `status: ${st.reply}`
      const p1 = await say("stop timer")
      if (noAi(p1, "stop")) return noAi(p1, "stop")
      const stopped = ofType(p1, "TIMER_STOPPED")[0] as any
      if (!stopped || stopped.minutes < 44 || stopped.minutes > 46 || !/Stopped dsa practice: 4[456] min/.test(p1.reply)) return `stop: ${p1.reply}`
      if ((await projectMinutes()) !== stopped.minutes) return `goal got ${await projectMinutes()} min, expected ${stopped.minutes} (counted once)`
      if (await runningEntry()) return "a timer is still running after stop"

      // A name that matches nothing is just a label; a new start closes the old one.
      await say("start timer for reading")
      const g = await say("start gym timer")
      if (!/Stopped reading/.test(g.reply)) return `starting a second timer: ${g.reply}`
      await back(20)
      const p2 = await say("stop timer")
      if (!/Stopped gym: 2[01] min/.test(p2.reply)) return `gym: ${p2.reply}`
      if ((await db.timeEntry.count({ where: { userId, endedAt: null } })) !== 0) return "two timers running"

      // A forgotten timer is asked about, never guessed; a number from the person closes it.
      await say("start timer for writing")
      await back(5 * 60)
      const f = await say("stop timer")
      if (!/forgotten|looks like/.test(f.reply) || !(await runningEntry())) return `forgotten timer: ${f.reply}`
      const fixed = await say("stop timer, it was 30 min")
      if (!/Stopped writing: 30 min/.test(fixed.reply) || (await runningEntry())) return `fixed: ${fixed.reply}`

      // Where the time went, plain and without judging the rest.
      const w = await say("where did my time go today?")
      if (noAi(w, "where")) return noAi(w, "where")
      if (!/Dsa practice 4[456] min/.test(w.reply) || !/Gym 2[01] min/.test(w.reply) || !/Writing 30 min/.test(w.reply) || !/timed in all/.test(w.reply)) return `where: ${w.reply}`
      if (/wast|lazy|idle|behind|should|only|fail/i.test(w.reply)) return `judging wording: ${w.reply}`

      // Undo of a stop removes the entry and the minutes it added to the goal.
      if ((await api("post", `/activity/${stopped.activityId}/undo`)).status !== 200) return "undo failed"
      if ((await projectMinutes()) !== 0) return `undo left ${await projectMinutes()} min on the goal`
      if (await db.timeEntry.findFirst({ where: { userId, label: "dsa practice" } })) return "undo left the time entry"

      // Discard saves nothing and can be undone.
      await say("start timer for email")
      const d = await say("discard timer")
      if (!/Nothing was saved/.test(d.reply) || (await runningEntry())) return `discard: ${d.reply}`
      if ((await api("post", `/activity/${d.actions[0]!.activityId}/undo`)).status !== 200 || !(await runningEntry())) return "undo of discard did not bring the timer back"
      const none = await say("discard timer")
      const stopNone = await say("stop timer")
      if (!/No timer is running/.test(stopNone.reply)) return `stop with none: ${stopNone.reply}`
      return none.usedAi ? "discard used the AI" : null
    },
  },
]
