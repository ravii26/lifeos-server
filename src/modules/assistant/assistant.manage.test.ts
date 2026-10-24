import { describe, expect, it } from "vitest"
import { choiceText, findItems, manageIntent, type Item } from "./assistant.manage.js"

const item = (id: string, kind: Item["kind"], title: string): Item => ({ id, kind, title })

describe("what they ask for", () => {
  it("delete / remove / archive, with or without the kind", () => {
    expect(manageIntent("delete my gym habit")).toMatchObject({ verb: "REMOVE", strong: true, kind: "HABIT", name: "gym", all: false })
    expect(manageIntent("remove the habit gym")).toMatchObject({ verb: "REMOVE", kind: "HABIT", name: "gym" })
    expect(manageIntent("archive passport")).toMatchObject({ verb: "REMOVE", kind: null, name: "passport" })
    expect(manageIntent("Delete the reminder for mom's call")).toMatchObject({ verb: "REMOVE", kind: "REMINDER", name: "mom's call" })
    expect(manageIntent("remove my guitar goal")).toMatchObject({ kind: "PROJECT", name: "guitar" })
    expect(manageIntent("please delete the breakfast note")).toMatchObject({ kind: "NOTE", name: "breakfast" })
  })
  it("weaker words only act when something matches", () => {
    expect(manageIntent("drop the guitar goal")).toMatchObject({ verb: "REMOVE", strong: false, kind: "PROJECT", name: "guitar" })
    expect(manageIntent("cancel my water habit")).toMatchObject({ strong: false, kind: "HABIT", name: "water" })
    expect(manageIntent("I don't want the water habit anymore")).toMatchObject({ strong: false, kind: "HABIT", name: "water" })
  })
  it("pause, bring back and rename", () => {
    expect(manageIntent("pause my reading habit")).toMatchObject({ verb: "PAUSE", kind: "HABIT", name: "reading" })
    expect(manageIntent("bring back my gym habit")).toMatchObject({ verb: "RESTORE", kind: "HABIT", name: "gym" })
    expect(manageIntent("resume guitar")).toMatchObject({ verb: "RESTORE", name: "guitar" })
    expect(manageIntent("rename passport to renew passport")).toMatchObject({ verb: "RENAME", name: "passport", to: "renew passport" })
    expect(manageIntent("rename my breakfast note to morning food")).toMatchObject({ verb: "RENAME", kind: "NOTE", name: "breakfast", to: "morning food" })
  })
  it("all of one kind", () => {
    expect(manageIntent("delete all my habits")).toMatchObject({ verb: "REMOVE", kind: "HABIT", all: true })
    expect(manageIntent("remove all reminders")).toMatchObject({ kind: "REMINDER", all: true })
    expect(manageIntent("delete my habits")).toMatchObject({ kind: "HABIT", all: true })
  })
  it("a yes to the count question, and a no", () => {
    expect(manageIntent("Yes, remove all 7 habits")).toMatchObject({ verb: "REMOVE", kind: "HABIT", all: true, confirmed: 7 })
    expect(manageIntent("yes, remove all 5 to-dos")).toMatchObject({ kind: "TASK", confirmed: 5 })
    expect(manageIntent("No, keep them")).toMatchObject({ verb: "KEEP" })
  })
  it("a 'which one?' choice is understood again", () => {
    for (const verb of ["REMOVE", "PAUSE", "RESTORE"] as const) {
      const text = choiceText(verb, item("1", "TASK", "Pack gym bag"))
      expect(manageIntent(text)).toMatchObject({ verb, kind: "TASK", name: "Pack gym bag" })
    }
  })
  it("leaves everything else alone", () => {
    expect(manageIntent("delete it")).toBeNull() // the follow-up undo
    expect(manageIntent("remove that")).toBeNull()
    expect(manageIntent("remove sugar from my diet note")).toBeNull() // changing a note's items
    expect(manageIntent("remind me to call mom")).toBeNull()
    expect(manageIntent("I want to delete everything I wrote about my old job and start over fresh again")).toBeNull() // too long to be a command
    expect(manageIntent("stop the nightly reminders")).toBeNull()
  })
})

describe("finding it by name", () => {
  const items = [
    item("a", "HABIT", "Gym session"),
    item("b", "TASK", "Pack gym bag"),
    item("c", "HABIT", "Drink water"),
    item("d", "PROJECT", "Learn guitar"),
    item("e", "TASK", "Renew passport"),
  ]
  it("one clear match", () => {
    expect(findItems("water", items)).toEqual({ type: "ONE", item: items[2] })
    // "limit" only says what kind of habit it is (ADR 0037); it is ignored when nothing else matches.
    const ig = { kind: "HABIT", id: "ig", title: "Instagram" } as Item
    expect(findItems("instagram limit", [...items, ig])).toEqual({ type: "ONE", item: ig })
    expect(findItems("limit", [...items, ig])).toEqual({ type: "NONE" })
    expect(findItems("passport", items)).toEqual({ type: "ONE", item: items[4] })
    expect(findItems("guitar", items)).toEqual({ type: "ONE", item: items[3] })
  })
  it("an exact title wins", () => {
    expect(findItems("Gym session", items)).toEqual({ type: "ONE", item: items[0] })
    expect(findItems("pack gym bag", items)).toEqual({ type: "ONE", item: items[1] })
  })
  it("several matches become a question", () => {
    const r = findItems("gym", items)
    expect(r.type).toBe("MANY")
    if (r.type === "MANY") expect(r.items.map((i) => i.id).sort()).toEqual(["a", "b"])
  })
  it("every word they said has to be there", () => {
    expect(findItems("gym bag", items)).toEqual({ type: "ONE", item: items[1] })
    expect(findItems("gym dance", items)).toEqual({ type: "NONE" })
    expect(findItems("spanish", items)).toEqual({ type: "NONE" })
  })
  it("forgives small spelling differences in long words", () => {
    expect(findItems("exercise", [item("x", "HABIT", "Exercising daily")])).toMatchObject({ type: "ONE" })
  })
})
