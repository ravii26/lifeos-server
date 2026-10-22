import { describe, expect, it } from "vitest"
import { screenIntent } from "./assistant.screen.js"
import { NOTHING_CHANGED, unbackedClaim } from "./assistant.guards.js"
import { manageIntent } from "./assistant.manage.js"
import { editIntent } from "./assistant.manage.edit.js"
import { showIntent } from "./assistant.manage.show.js"
import { preferenceIntent } from "../settings/personalization.rules.js"

describe("the Now card, by talking", () => {
  it("not now / skip", () => {
    expect(screenIntent("not now")).toEqual({ kind: "NOT_NOW", name: null })
    expect(screenIntent("Okay, skip it for today")).toEqual({ kind: "NOT_NOW", name: null })
    expect(screenIntent("pass")).toBeNull() // too vague on its own
    expect(screenIntent("skip gym today")).toEqual({ kind: "NOT_NOW", name: "gym" })
    expect(screenIntent("skip the gym habit")).toEqual({ kind: "NOT_NOW", name: "gym habit" })
    expect(screenIntent("skip it")).toEqual({ kind: "NOT_NOW", name: null })
  })
  it("smaller, and the minimum", () => {
    expect(screenIntent("make it smaller")).toEqual({ kind: "SMALLER" })
    expect(screenIntent("give me a smaller version")).toEqual({ kind: "SMALLER" })
    expect(screenIntent("I only did the minimum")).toEqual({ kind: "MINIMUM", name: null, minutes: null })
    expect(screenIntent("just did the minimum of gym")).toEqual({ kind: "MINIMUM", name: "gym", minutes: null })
    expect(screenIntent("I only did 10 minutes of gym")).toEqual({ kind: "MINIMUM", name: "gym", minutes: 10 })
  })
  it("too much today, prep, low energy", () => {
    expect(screenIntent("move the extra stuff to later")).toEqual({ kind: "MOVE_EXTRA" })
    expect(screenIntent("push what doesn't fit to later")).toEqual({ kind: "MOVE_EXTRA" })
    expect(screenIntent("I prepped the oats")).toEqual({ kind: "PREP", what: "oats" })
    expect(screenIntent("prep done")).toEqual({ kind: "PREP", what: "" })
    expect(screenIntent("low energy today")).toEqual({ kind: "LOW_ENERGY", on: true })
    expect(screenIntent("I'm low on energy today")).toEqual({ kind: "LOW_ENERGY", on: true })
    expect(screenIntent("back to full energy")).toEqual({ kind: "LOW_ENERGY", on: false })
  })
  it("memory privacy and the account", () => {
    expect(screenIntent("make my tea memory private")).toEqual({ kind: "PRIVATE", what: "tea", value: true })
    expect(screenIntent("mark the knee injury as not private")).toEqual({ kind: "PRIVATE", what: "knee injury", value: false })
    expect(screenIntent("make it private")).toBeNull()
    expect(screenIntent("sign me out")).toEqual({ kind: "ACCOUNT", what: "SIGN_OUT" })
    expect(screenIntent("export my data")).toEqual({ kind: "ACCOUNT", what: "EXPORT" })
  })
  it("leaves ordinary talk to the AI", () => {
    for (const t of ["I'm tired", "what should I do now", "remind me to skip the gym on Friday", "I did 30 min of English", "skip the intro of this video and tell me the rest"]) {
      expect(screenIntent(t), t).toBeNull()
    }
  })
  it("does not take sentences the other commands own", () => {
    for (const t of ["delete my gym habit", "show my habits", "set the gym habit to 7 am", "be quieter", "make passport high priority", "undo that", "rename passport to renew passport"]) {
      expect(screenIntent(t), t).toBeNull()
    }
  })
  it("and the other commands do not take these", () => {
    for (const t of ["not now", "skip gym today", "make it smaller", "I only did 10 minutes of gym", "move the extra stuff to later", "I prepped the oats", "low energy today", "make my tea memory private", "sign me out"]) {
      expect(manageIntent(t), t).toBeNull()
      expect(editIntent(t), t).toBeNull()
      expect(showIntent(t), t).toBeNull()
      expect(preferenceIntent(t), t).toBeNull()
    }
  })
})

describe("never claim what didn't happen", () => {
  it("a claim with no action is replaced", () => {
    for (const r of ["Skipped for today.", "Done.", "Moving your extra tasks to later today.", "Ok, marked as private.", "I have marked your memory as private.", "I've moved it to tomorrow."]) {
      expect(unbackedClaim(r, 0), r).toBe(true)
    }
    expect(NOTHING_CHANGED).toMatch(/didn't change anything/)
  })
  it("a claim with an action stands, and ordinary talk is left alone", () => {
    expect(unbackedClaim("Done.", 1)).toBe(false)
    for (const r of ["Ten minutes still counts.", "That sounds like a heavy day. What's on your mind?", "Set a time and I'll remind you.", "I'll remind you tomorrow."]) {
      expect(unbackedClaim(r, 0), r).toBe(false)
    }
  })
})

describe("pointers and more claims", () => {
  it("saves on the shelf point to the Saved screen", () => {
    expect(screenIntent("put my saved videos on the hard days shelf")).toEqual({ kind: "SHELF_POINTER" })
    expect(screenIntent("add this to the comfort shelf")).toEqual({ kind: "SHELF_POINTER" })
    expect(screenIntent("what is a hard days shelf")).toBeNull()
  })
  it("a state claim with no action is caught", async () => {
    const { unbackedStateClaim } = await import("./assistant.guards.js")
    expect(unbackedStateClaim("I've noted that. Memory settings updated.", 0)).toBe(true)
    expect(unbackedStateClaim("Your list has been updated.", 0)).toBe(true)
    expect(unbackedStateClaim("Memory settings updated.", 1)).toBe(false)
    expect(unbackedStateClaim("Tell me when your plan is updated on your side.", 0)).toBe(false)
  })
})
