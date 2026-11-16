import { describe, expect, it } from "vitest"
import { provenance } from "./assistant.origin.js"

describe("where a chat item came from", () => {
  it("a thing in their own words is said, with the part they said", () => {
    const o = provenance("Remind me to call the bank tomorrow. Also buy milk.", { title: "Call the bank" })
    expect(o).toMatchObject({ origin: "SAID", said: "Remind me to call the bank tomorrow" })
  })

  it("an item whose words are not theirs is Ally's idea, with what it is for and why", () => {
    const o = provenance("I want to read 10 pages every night", { title: "Put the book on the pillow", for: "read 10 pages every night", detail: "Makes starting easier" })
    expect(o).toMatchObject({ origin: "IDEA", ideaFor: "read 10 pages every night", reason: "Makes starting easier" })
  })

  it("the AI's own claim that it is an idea wins even when the words overlap", () => {
    const o = provenance("I need to renew my passport", { title: "Renew passport photos", suggested: true, detail: "Needed for the form" })
    expect(o).toMatchObject({ origin: "IDEA", reason: "Needed for the form" })
  })

  it("the AI's claim that it is theirs does not count when the words are not", () => {
    const o = provenance("I want to sleep earlier", { title: "Buy blackout curtains", suggested: false })
    expect(o.origin).toBe("IDEA")
  })

  it("a quote the person never said is ignored (nothing is claimed as theirs)", () => {
    const o = provenance("I want to sleep earlier", { title: "Buy blackout curtains", suggested: true, for: "invented words" })
    expect(o.origin).toBe("IDEA")
    expect((o as { ideaFor?: string }).ideaFor).toBeUndefined()
  })

  it("a note is judged by its collection when it has no title", () => {
    const o = provenance("my breakfast options are oats, eggs and toast", { collection: "Breakfast options" })
    expect(o).toMatchObject({ origin: "SAID" })
  })

  it("nothing to judge against gives nothing", () => {
    expect(provenance("", { title: "Call the bank" })).toEqual({})
    expect(provenance("hello", { title: "" })).toEqual({})
  })
})
