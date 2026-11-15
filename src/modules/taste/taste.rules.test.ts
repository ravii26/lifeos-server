import { describe, expect, it } from "vitest"
import { cleanTastes, decisionWords, fallbackTastes, roundOf, tasteTitle } from "./taste.rules.js"

describe("three tastes", () => {
  it("always three, each 15 to 90 minutes, filled from the fallback", () => {
    const t = cleanTastes([{ title: "Play three chords", minutes: 60 }, { title: "", minutes: 20 }, { title: "Hum a tune", minutes: 500 }], "Music")
    expect(t).toEqual([
      { title: "Play three chords", minutes: 60 },
      { title: "Hum a tune", minutes: 30 },
      fallbackTastes("Music")[2],
    ])
  })

  it("accepts the model's object shape and drops its own numbering", () => {
    const t = cleanTastes({ tastes: [{ title: "Taste 1: sketch for 20 minutes", minutes: 20 }] }, "Drawing")
    expect(t[0]).toEqual({ title: "sketch for 20 minutes", minutes: 20 })
    expect(t).toHaveLength(3)
  })

  it("nothing usable: the generic three, named after the area", () => {
    expect(cleanTastes(null, "Pottery").map((x) => x.title)).toEqual(fallbackTastes("Pottery").map((x) => x.title))
    expect(fallbackTastes("Pottery")[0]!.title).toContain("Pottery")
  })

  it("titles are numbered by code", () => {
    expect(tasteTitle(2, "hum a melody")).toBe("Taste 2: hum a melody")
    expect(tasteTitle(2, "Taste 9 - hum a melody")).toBe("Taste 2: hum a melody")
  })
})

describe("a round", () => {
  const t = (status: string, archived = false) => ({ status, archivedAt: archived ? new Date() : null })

  it("counts what is done, and asks for a decision when all are", () => {
    expect(roundOf("g", [t("COMPLETED"), t("TODO"), t("TODO")])).toEqual({ goalId: "g", done: 1, total: 3, decide: false })
    expect(roundOf("g", [t("COMPLETED"), t("COMPLETED"), t("COMPLETED")]).decide).toBe(true)
  })

  it("a taste let go no longer counts, so two done of two decides", () => {
    expect(roundOf("g", [t("COMPLETED"), t("COMPLETED"), t("CANCELLED", true)])).toEqual({ goalId: "g", done: 2, total: 2, decide: true })
  })

  it("dropping is said without judgment", () => {
    expect(decisionWords("DROP", "Music")).toBe("Music is resting. Dropping it on purpose is a decision, not a failure.")
  })
})
