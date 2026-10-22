import { describe, expect, it } from "vitest"
import { cleanMood, cleanMoods, comfortBlock, customMoodIn, feelingIn, matchComfort, normalizeFeeling, ownMoods, type ShelfItem } from "./comfort.rules.js"

const item = (id: string, tags: string[], used = 0, helpful = 0): ShelfItem => ({ id, title: `Save ${id}`, url: null, triggerTags: tags, usedCount: used, helpfulCount: helpful })

describe("feelings", () => {
  it("reads how someone feels", () => {
    expect(feelingIn("I feel lazy today")).toBe("lazy")
    expect(feelingIn("so anxious about tomorrow")).toBe("anxious")
    expect(feelingIn("I'm exhausted")).toBe("tired")
    expect(feelingIn("I feel like I'm going nowhere")).toBe("stuck")
  })
  it("ignores ordinary talk and words inside other words", () => {
    expect(feelingIn("remind me to call mom")).toBeNull()
    expect(feelingIn("I made dinner")).toBeNull()
  })
  it("maps the model's wording to the same key", () => {
    expect(normalizeFeeling("laziness")).toBe("lazy")
    expect(normalizeFeeling("lazy")).toBe("lazy")
    expect(normalizeFeeling("unmotivated")).toBe("unmotivated")
  })
})

describe("what comes back", () => {
  it("only items saved for that feeling", () => {
    const shelf = [item("a", ["lazy", "unmotivated"]), item("b", ["sad"]), item("c", ["hard-day"])]
    expect(matchComfort("I feel lazy", shelf).map((i) => i.id)).toEqual(["a"])
  })
  it("rotates: what helped first, then the least used", () => {
    const shelf = [item("a", ["lazy"], 5, 0), item("b", ["lazy"], 1, 0), item("c", ["lazy"], 9, 2)]
    expect(matchComfort("lazy", shelf).map((i) => i.id)).toEqual(["c", "b", "a"])
  })
  it("nothing saved means nothing returned, never an invention", () => {
    expect(matchComfort("lonely", [item("a", ["lazy"])])).toEqual([])
  })
  it("wording of the block names the save and the step", () => {
    expect(comfortBlock({ title: "Nobody is coming", url: "https://x.y/z" }, "Open the doc (2 min)")).toBe(
      'You saved this for days like this: "Nobody is coming" (https://x.y/z). Smallest next step: Open the doc (2 min)',
    )
  })
})

describe("the person's own moods", () => {
  it("cleans what they type", () => {
    expect(cleanMood("When I'm bored.")).toBe("bored")
    expect(cleanMood("  Before an   EXAM ")).toBe("before an exam")
    expect(cleanMood("for when I need to focus")).toBe("need to focus")
    expect(cleanMood("x")).toBeNull()
    expect(cleanMood("a mood name that is far too long to be a label")).toBeNull()
    expect(cleanMood(42)).toBeNull()
  })
  it("maps words the fixed list covers to that word, keeps the rest as typed", () => {
    expect(cleanMoods(["I'm exhausted", "bored", "Bored!", "before an exam", "tired", "four extra"])).toEqual(["tired", "bored", "before an exam"])
    expect(cleanMoods("nope")).toEqual([])
  })
  it("lists their own moods, most used first, leaving out the fixed words", () => {
    const shelf = [item("a", ["tired", "bored"]), item("b", ["bored", "before an exam"]), item("c", ["lazy"])]
    expect(ownMoods(shelf)).toEqual([
      { mood: "bored", count: 2 },
      { mood: "before an exam", count: 1 },
    ])
  })
  it("recognises a mood in a sentence only when they are saying it", () => {
    const mine = ["bored", "before an exam", "need to focus"]
    expect(customMoodIn("I'm bored", mine)).toBe("bored")
    expect(customMoodIn("bored", mine)).toBe("bored")
    expect(customMoodIn("show me something for before an exam", mine)).toBe("before an exam")
    expect(customMoodIn("the bored cat sat on the long wide mat all afternoon", mine)).toBeNull()
    expect(customMoodIn("remind me to call mom", mine)).toBeNull()
  })
  it("brings back items saved for exactly that mood, rotating like the others", () => {
    const shelf = [item("a", ["bored"], 3), item("b", ["bored"], 1), item("c", ["tired"]), item("d", ["before an exam"])]
    expect(matchComfort("bored", shelf).map((i) => i.id)).toEqual(["b", "a"])
    expect(matchComfort("when I'm before an exam", shelf).map((i) => i.id)).toEqual(["d"])
    expect(matchComfort("an unknown mood", shelf)).toEqual([])
  })
})
