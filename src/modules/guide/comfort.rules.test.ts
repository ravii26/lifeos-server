import { describe, expect, it } from "vitest"
import { comfortBlock, feelingIn, matchComfort, normalizeFeeling, type ShelfItem } from "./comfort.rules.js"

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
