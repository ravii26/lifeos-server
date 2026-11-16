import { describe, expect, it } from "vitest"
import { briefByCode, checkBrief, checkClearer } from "./brief.rules.js"

const step = { title: "Draft the intro", minutes: 25, smaller: null as string | null }

describe("the doing-it brief", () => {
  it("without AI: a plain way in and an end to reach", () => {
    const b = briefByCode(step)
    expect(b.byCode).toBe(true)
    expect(b.begin).toContain("first two minutes")
    expect(b.done).toBe("You can say “draft the intro” is done, or you gave it 25 minutes. Either counts.")
  })
  it("without AI: the smaller version is the way in", () => {
    expect(briefByCode({ ...step, smaller: "write one line" }).begin).toBe("Write one line.")
  })
  it("keeps the AI's lines when they are usable", () => {
    const b = checkBrief({ begin: "Open the document and write the first sentence, however rough", done: "Three paragraphs that say what the piece is about" }, step)
    expect(b).toEqual({ begin: "Open the document and write the first sentence, however rough.", done: "Three paragraphs that say what the piece is about.", byCode: false })
  })
  it("a line that is empty, tiny or just the title again falls back", () => {
    const b = checkBrief({ begin: "Draft the intro.", done: "" }, step)
    expect(b).toEqual(briefByCode(step))
    expect(checkBrief(null, step).byCode).toBe(true)
    expect(checkBrief({ begin: 5, done: ["x"] }, step).byCode).toBe(true)
  })
  it("the person's own smaller version is never replaced by the AI's", () => {
    const b = checkBrief({ begin: "Open the document and type a title", done: "A full first draft of the intro" }, { ...step, smaller: "Write one line" })
    expect(b.begin).toBe("Write one line.")
    expect(b.done).toBe("A full first draft of the intro.")
    expect(b.byCode).toBe(false)
  })
  it("long lines are cut", () => {
    expect(checkBrief({ begin: "a".repeat(400), done: "b".repeat(400) }, step).begin.length).toBeLessThanOrEqual(161)
  })
})

describe("a clearer wording", () => {
  it("is offered only when it is a real, different title", () => {
    expect(checkClearer({ title: "Write three sentences for the intro." }, "Work on intro")).toBe("Write three sentences for the intro")
    expect(checkClearer({ title: "work on intro" }, "Work on intro")).toBeNull()
    expect(checkClearer({ title: "" }, "Work on intro")).toBeNull()
    expect(checkClearer(null, "Work on intro")).toBeNull()
  })
})
