/* =====================================================================
   The fitness weekly plan (decisions log #1, Phase 1 pilot of "a weekly
   plan Ally runs for you"). Built by code from five answers, so it is free,
   instant, the same every time, and safe to test. AI isn't needed: the
   plan is a small set of well-known general rules, and the person's own
   answers fill it in. General guidance only, never medical.

   The plan is made of things Ally already runs: a goal with a weight
   target (weekly weigh-in), two habits with fixed days and smallest
   versions (the Now card picks them), and a "Fitness rules" note (chat
   reads it back: "aaj party hai").
   ===================================================================== */

export type FitGoal = "LOSE_BELLY" | "LOSE_WEIGHT" | "BUILD_MUSCLE" | "STAMINA"
export type FitWhere = "GYM" | "HOME" | "BOTH"
export type Diet = "VEG" | "VEG_EGG" | "NON_VEG"
export type Health = "NONE" | "CONDITION" | "JOINT"

export interface FitnessAnswers {
  goal: FitGoal
  weightKg?: number | null
  heightCm?: number | null
  where: FitWhere
  diet?: Diet | null
  homeFood: boolean
  messFood: boolean
  outsideOften: boolean
  health: Health
}

export interface SessionPlan {
  key: "STRENGTH" | "WALK"
  title: string
  minutes: number
  smallest: string
  days: string[] // full shape, from week 2
  week1Days: string[] // week 1 is capped: early overdoing is why most people quit
  detail: string // what to do, in plain words
}

export interface FitnessPlan {
  title: string
  phaseWeeks: number
  weight: { start: number; target: number } | null
  sessions: SessionPlan[]
  foodRules: string[]
  lifeRules: string[] // parties, cravings, knees: read back when the moment comes
  cautions: string[]
}

export const PHASE_WEEKS = 8
export const WEEK1_CAP = 4
const SAFE_LOSS_PER_WEEK = 0.5 // kg

const LOSS_GOALS: FitGoal[] = ["LOSE_BELLY", "LOSE_WEIGHT"]

const GYM_KNEE = [
  "Day A: leg press (light), glute bridges, seated row, chest press, plank",
  "Day B: hip thrusts, wall sit, lat pulldown, shoulder press, side plank",
  "Day C: light Romanian deadlift, low step-ups only if comfortable, dumbbell row, incline push-ups, dead bug",
  "Finish each day with 10–15 minutes of easy cycling",
]
const GYM = [
  "Day A: squats, bench press, seated row, plank",
  "Day B: Romanian deadlift, shoulder press, lat pulldown, side plank",
  "Day C: lunges, incline dumbbell press, dumbbell row, dead bug",
  "Finish each day with 10 minutes of cycling or incline walking",
]
const HOME_KNEE = [
  "Day A: glute bridges, wall push-ups, plank, slow marching in place",
  "Day B: wall sit (short), chair-supported calf raises, superman hold, side plank",
  "Day C: bridges with a hold, incline push-ups on a table, dead bug, 10 minutes of brisk walking",
]
const HOME = [
  "Day A: squats to a chair, push-ups (incline if needed), plank",
  "Day B: lunges, pike push-ups or wall push-ups, side plank",
  "Day C: step-ups on a stair, burpees without the jump, dead bug",
]

const proteinFoods = (diet?: Diet | null): string =>
  diet === "VEG" ? "dal, paneer, curd, chana, soya" : diet === "NON_VEG" ? "eggs, chicken, fish, dal, curd" : diet === "VEG_EGG" ? "eggs, dal, paneer, curd" : "dal, paneer, curd, eggs if you eat them"

const titleFor = (a: FitnessAnswers, weight: FitnessPlan["weight"]): string => {
  if (weight && a.goal === "LOSE_BELLY") return `${weight.start} → ${weight.target} kg, belly first`
  if (weight) return `${weight.start} → ${weight.target} kg`
  return { LOSE_BELLY: "Lose belly fat", LOSE_WEIGHT: "Lose weight", BUILD_MUSCLE: "Build muscle", STAMINA: "Build stamina" }[a.goal]
}

export const buildFitnessPlan = (a: FitnessAnswers): FitnessPlan => {
  const knee = a.health === "JOINT"
  const weightOk = typeof a.weightKg === "number" && a.weightKg >= 30 && a.weightKg <= 250
  const weight =
    weightOk && LOSS_GOALS.includes(a.goal)
      ? { start: Math.round(a.weightKg! * 10) / 10, target: Math.round((a.weightKg! - SAFE_LOSS_PER_WEEK * PHASE_WEEKS) * 10) / 10 }
      : null
  const home = a.where === "HOME"
  const strengthDetail = (home ? (knee ? HOME_KNEE : HOME) : knee ? GYM_KNEE : GYM).join("\n")
  const strength: SessionPlan = {
    key: "STRENGTH",
    title: home ? (knee ? "Home workout (knee-friendly)" : "Home workout") : knee ? "Gym: knee-friendly strength + cycling" : "Gym: strength",
    minutes: a.goal === "BUILD_MUSCLE" ? 50 : 40,
    smallest: "A 15-minute walk counts",
    days: ["MON", "WED", "FRI"],
    week1Days: ["MON", "WED", "FRI"],
    detail: strengthDetail,
  }
  const walk: SessionPlan = {
    key: "WALK",
    title: knee ? "Brisk walk on flat ground" : a.goal === "STAMINA" ? "Brisk walk or easy jog" : "Brisk walk",
    minutes: 30,
    smallest: "10 minutes of walking counts",
    days: ["TUE", "THU", "SAT"],
    week1Days: ["SAT"], // 3 strength + 1 walk = the week-1 cap of 4
    detail: knee ? "Flat ground, comfortable shoes. No running for now." : "Fast enough that talking takes a little effort.",
  }

  const foodRules = [
    `Protein in every meal (${proteinFoods(a.diet)})`,
    "No sugary drinks",
    a.outsideOften ? "Junk or outside food twice a week, planned (for example Saturday with friends)" : "Outside food at most twice a week",
  ]
  if (a.messFood) foodRules.push("Mess or PG food: skip the fried item, add curd, dal or eggs")
  if (a.homeFood && !a.messFood) foodRules.push("Family cooks? Change portions, not the menu: fewer rotis, more dal and sabzi")

  const lifeRules = [
    "Party or wedding: protein first, one plate, water between drinks",
    "Craving after work: have the ready snack first (fruit, curd, roasted chana)",
    "Missed a day: nothing resets. Next session is the next session",
  ]
  if (knee) lifeRules.push("Knee hurts: switch to cycling or a flat walk. Sharp pain or swelling: stop and see a doctor")

  const cautions = ["General guidance, not medical advice."]
  if (a.health === "CONDITION") cautions.push("With BP, sugar, thyroid or PCOS, check with your doctor before starting, and keep the plan this gentle until they say otherwise.")
  if (knee) cautions.push("Knee-friendly by default: no running and no jumping for now.")

  return { title: titleFor(a, weight), phaseWeeks: PHASE_WEEKS, weight, sessions: [strength, walk], foodRules, lifeRules, cautions }
}

// After a good week (decisions log #1): from week 2 the walks fill out to the full shape.
export const daysForWeek = (s: SessionPlan, week: number): string[] => (week <= 1 ? s.week1Days : s.days)
