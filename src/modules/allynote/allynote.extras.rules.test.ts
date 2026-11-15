import { describe, expect, it } from "vitest"
import { cleanDraft, fallbackDraft, rulesForToday, triggerWords } from "./allynote.extras.rules.js"

describe("rules before an event", () => {
  it("what a set of rules is for, from its title", () => {
    expect(triggerWords("Party and outside-food rules")).toEqual(["party", "outside", "food"])
    expect(triggerWords("Interview ready lines", "Career")).toEqual(["interview", "career"])
  })

  const notes = [
    { id: "n1", title: "Party and outside-food rules", collection: "Fitness", items: ["Eat before you go"], showBefore: true },
    { id: "n2", title: "Interview ready lines", collection: "Career", items: ["Tell me about yourself"], showBefore: false },
  ]

  it("shows only rules switched on, when something today or tomorrow matches", () => {
    expect(rulesForToday(notes, [{ title: "Asha's birthday party" }])).toEqual([
      { id: "n1", title: "Party and outside-food rules", items: ["Eat before you go"], because: "Asha's birthday party" },
    ])
    expect(rulesForToday(notes, [{ title: "Interview at 11" }])).toEqual([])
    expect(rulesForToday(notes, [{ title: "Pay rent" }])).toEqual([])
  })
})

describe("a message Ally drafts", () => {
  it("keeps a short plain draft; drops links and long ones", () => {
    expect(cleanDraft(' "Hi Asha, how did the new job start?" ')).toBe("Hi Asha, how did the new job start?")
    expect(cleanDraft("See https://x.y")).toBeNull()
    expect(cleanDraft("x".repeat(400))).toBeNull()
    expect(cleanDraft(null)).toBeNull()
  })
  it("without AI, a warm opener that notices a long gap", () => {
    expect(fallbackDraft("Asha Rao", 30)).toBe("Hi Asha, it's been a while. How have you been?")
    expect(fallbackDraft("Asha", 2)).toBe("Hi Asha, how are you doing?")
  })
})
