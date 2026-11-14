/* =====================================================================
   "I've got time": the best use of a free window, across every area.
   Pure rules, no DB, no AI.

   The Now card answers "what is planned for this part of the day". This
   answers a different question: "I have 40 minutes, what should I do?".
   So it looks at every area, not only the main ones, and gives one pick
   per area: the first is the suggestion, the rest are "Something else".

   Areas keep their four tiers; here they read as modes:
     MAIN = Push · SECONDARY = Maintain · MAINTAIN = Explore · LATER = Rest
   ===================================================================== */
import type { Tier } from "../guide/guide.rules.js"
import { daysUntil, scoreItem, whyFromReasons } from "./brain.rules.js"
import { DEFAULT_SIZE, sizeFor, type Mode, type NowCandidate } from "./now.rules.js"

export const ENERGIES = ["LOW", "OKAY", "GOOD"] as const
export type Energy = (typeof ENERGIES)[number]
export const PLACES = ["HOME", "OUT"] as const
export type Place = (typeof PLACES)[number]

// Why a pick is offered. DATED = has a date in the next day; LOOSE = belongs to no area.
export type Lane = "DATED" | "PUSH" | "MAINTAIN" | "EXPLORE" | "LOOSE"

export interface FreeInput {
  minutes: number
  energy: Energy
  place: Place
  todayKey: string
  weekday: number // 0 = Sunday
  mode: Mode
  candidates: NowCandidate[]
}

export interface FreePick {
  sourceType: "TASK" | "HABIT" | "PROJECT"
  sourceId: string
  title: string
  count: number | null
  minutes: number // how long this takes now (the smaller version when applicable)
  fullMinutes: number
  smaller: boolean
  minimum: string
  why: string
  detail?: string
  areaId: string | null
  areaName: string | null
  lane: Lane
}

export interface FreeResult {
  kind: "PICK" | "REST"
  minutes: number
  message: string
  picks: FreePick[]
}

// On a low-energy day anything longer than this is offered as its smallest version.
export const LOW_ENERGY_MAX = 15
// A block this long (or a weekend day) is when the areas you only explore get their turn.
export const REAL_BLOCK = 60
// An area you keep going that has been quiet this long is due.
export const MAINTAIN_DUE_DAYS = 4
// An area nothing was ever done in: treated as quiet for this long.
const NEVER_TOUCHED_DAYS = 10
export const MAX_PICKS = 6

const laneOf = (c: NowCandidate, todayKey: string): Lane => {
  if (c.dueKey && daysUntil(todayKey, c.dueKey) <= 1) return "DATED"
  if (!c.areaName) return "LOOSE"
  return ({ MAIN: "PUSH", SECONDARY: "MAINTAIN", MAINTAIN: "EXPLORE", LATER: "EXPLORE" } as Record<Tier, Lane>)[c.tier]
}

const quietFor = (days: number): string => (days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} days`)

// Away from home there is no desk and no gym: only what was said to fit a commute, or anything with no set place in the day.
const fitsPlace = (c: NowCandidate, place: Place): boolean => (place === "OUT" ? c.block === null || c.block === "COMMUTE" : true)

export const freeTime = (input: FreeInput): FreeResult => {
  const minutes = Math.max(1, Math.round(input.minutes))
  if (input.mode === "SICK") {
    return { kind: "REST", minutes, picks: [], message: "You're in sick mode. Rest is the best use of this time." }
  }

  const weekend = input.weekday === 0 || input.weekday === 6
  const low = input.energy === "LOW" || input.mode !== "NORMAL"

  const scored = input.candidates
    // Resting areas stay out of the way; counts ("8 glasses") are a +1 line, not a session;
    // office work is not what free time is for; a prep step belongs to its evening.
    .filter((c) => c.tier !== "LATER" && !c.counted && c.block !== "OFFICE" && !/^prep\b/i.test(c.title) && fitsPlace(c, input.place))
    .map((c) => {
      const natural = c.sizeMinutes ?? DEFAULT_SIZE
      const size = sizeFor(c, minutes, low && natural > LOW_ENERGY_MAX)
      if (!size || size.minutes > minutes) return null

      const lane = laneOf(c, input.todayKey)
      const idle = c.areaIdleDays ?? NEVER_TOUCHED_DAYS
      // Scored with no tier points: in free time a main area does not win just by being main.
      const { score: base, reasons } = scoreItem(
        {
          tier: "LATER",
          priority: c.priority,
          dueKey: c.dueKey,
          deadlineKey: c.deadlineKey ?? null,
          goalTitle: c.goalTitle,
          areaName: null, // the lane line below already says how long the area has been quiet
          areaIdleDays: null,
          anchorText: null,
          blockMatch: false,
          minutes: size.minutes,
          available: minutes,
          skippedToday: c.skippedToday === true,
          target: c.target,
        },
        input.todayKey,
      )

      let bonus = 0
      let why = ""
      const area = c.areaName ?? ""
      switch (lane) {
        case "DATED":
          bonus = 300
          why = whyFromReasons(reasons, "It has a date.")
          break
        case "PUSH":
          if (idle === 0) {
            bonus = 25
            why = `${area} already had time today. This is extra.`
          } else {
            bonus = 70
            why = c.planWhy ?? whyFromReasons(reasons, `${area} is one of your main areas.`)
          }
          break
        case "MAINTAIN":
          if (idle >= MAINTAIN_DUE_DAYS) {
            bonus = 55 + Math.min(idle, 14)
            why = c.areaIdleDays == null ? `${area} hasn't had any time yet.` : `${area} hasn't had any time for ${quietFor(idle)}.`
          } else {
            bonus = 10
            why = whyFromReasons(reasons, `Keeps ${area} going.`)
          }
          break
        case "EXPLORE": {
          const realBlock = minutes >= REAL_BLOCK || weekend
          bonus = 15 + Math.min(idle, 30) * 2 + (realBlock ? 30 : 0)
          why =
            idle >= 3
              ? `${area} hasn't been touched ${c.areaIdleDays == null ? "yet" : `in ${quietFor(idle)}`}${minutes >= REAL_BLOCK ? ", and this is a real block of time." : "."}`
              : `A good moment for ${area}.`
          break
        }
        case "LOOSE":
          bonus = minutes < 20 ? 45 : 8
          why = "A small thing off your mind."
          break
      }
      if (input.energy === "GOOD" && size.minutes >= 30) bonus += 8
      if (low && size.minutes <= LOW_ENERGY_MAX) bonus += 8

      const pick: FreePick = {
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        title: c.title,
        count: c.count ?? null,
        minutes: size.minutes,
        fullMinutes: natural,
        smaller: size.smaller,
        minimum: c.minimum?.trim() || "Just start. 2 minutes on it counts.",
        why,
        ...(c.detail && { detail: c.detail }),
        areaId: c.areaId ?? null,
        areaName: c.areaName,
        lane,
      }
      return { pick, score: base + bonus, order: c.order }
    })
    .filter((x): x is { pick: FreePick; score: number; order: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order || a.pick.title.localeCompare(b.pick.title))

  // One pick per area, best first: "Something else" then walks through the other areas.
  const seen = new Set<string>()
  const picks: FreePick[] = []
  for (const s of scored) {
    // By id when known: two areas may share a name.
    const key = s.pick.areaId ?? s.pick.areaName ??"\u0000loose"
    if (seen.has(key)) continue
    seen.add(key)
    picks.push(s.pick)
    if (picks.length >= MAX_PICKS) break
  }

  if (!picks.length) {
    return { kind: "REST", minutes, picks, message: `Nothing fits ${minutes} minutes right now. Rest is a good use of it.` }
  }
  const top = picks[0]!
  const what = top.smaller ? top.minimum.replace(/\.$/, "") : top.title
  return { kind: "PICK", minutes, picks, message: `${what} (${top.minutes} min). ${top.why}`.replace(/\s+/g, " ").trim() }
}
