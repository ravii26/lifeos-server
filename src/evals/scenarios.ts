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
    activityId?: string
    time?: string | null
    kind?: string
    remindAt?: string
    windowEnd?: string
    repeatRule?: string
    title?: string
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
    options?: { id: string; title: string }[]
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
]
