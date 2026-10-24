import { describe, expect, it } from "vitest"
import {
  addedReply,
  findListItem,
  listIntent,
  openItems,
  resolveList,
  showReply,
  splitItems,
  tickedReply,
  wellKnownList,
  type ListNote,
} from "./lists.rules.js"

const note = (collection: string, title: string, items: string[] = [], done: string[] = []): ListNote => ({ id: collection, collection, title, items, done })

describe("splitItems", () => {
  it("splits on commas, and and ampersands, tidies and removes repeats", () => {
    expect(splitItems("milk, eggs and the bread")).toEqual(["Milk", "Eggs", "Bread"])
    expect(splitItems("2 litres milk & curd")).toEqual(["2 litres milk", "Curd"])
    expect(splitItems("milk, Milk")).toEqual(["Milk"])
  })
})

describe("listIntent", () => {
  it("adds to a list", () => {
    expect(listIntent("add milk to shopping")).toEqual({ kind: "ADD", items: ["Milk"], list: "shopping" })
    expect(listIntent("add milk, eggs and bread to my shopping list")).toEqual({ kind: "ADD", items: ["Milk", "Eggs", "Bread"], list: "shopping" })
    expect(listIntent("put Interstellar on my movies list")).toEqual({ kind: "ADD", items: ["Interstellar"], list: "movies" })
    expect(listIntent("we're out of milk")).toEqual({ kind: "ADD", items: ["Milk"], list: "shopping" })
    expect(listIntent("out of coffee and sugar")).toEqual({ kind: "ADD", items: ["Coffee", "Sugar"], list: "shopping" })
    expect(listIntent("I'm out of energy")).toBeNull()
  })
  it("ticks, unticks and removes", () => {
    expect(listIntent("got the milk")).toEqual({ kind: "TICK", items: ["Milk"], list: null })
    expect(listIntent("bought milk and eggs")).toEqual({ kind: "TICK", items: ["Milk", "Eggs"], list: null })
    expect(listIntent("watched Interstellar")).toEqual({ kind: "TICK", items: ["Interstellar"], list: null })
    expect(listIntent("tick off milk on shopping")).toEqual({ kind: "TICK", items: ["Milk"], list: "shopping" })
    expect(listIntent("untick milk")).toEqual({ kind: "UNTICK", items: ["Milk"], list: null })
    expect(listIntent("remove milk from shopping")).toEqual({ kind: "REMOVE", items: ["Milk"], list: "shopping" })
  })
  it("clears and shows", () => {
    expect(listIntent("clear what I got")).toEqual({ kind: "CLEAR", list: null, what: "TICKED" })
    expect(listIntent("clear the ticked items on shopping")).toEqual({ kind: "CLEAR", list: "shopping", what: "TICKED" })
    expect(listIntent("clear the shopping list")).toEqual({ kind: "CLEAR", list: "shopping", what: "ALL" })
    expect(listIntent("show shopping")).toEqual({ kind: "SHOW", list: "shopping" })
    expect(listIntent("what's on my movies list?")).toEqual({ kind: "SHOW", list: "movies" })
  })
  it("leaves other sentences alone", () => {
    expect(listIntent("hello")).toBeNull()
    expect(listIntent("I got a new job")).toEqual({ kind: "TICK", items: ["New job"], list: null }) // the service ignores it: no list has that item
    expect(listIntent("remind me to buy milk tomorrow at 9 am")).toBeNull()
  })
})

describe("resolveList and findListItem", () => {
  const lists = [note("Shopping", "Shopping list", ["Milk", "2 litres curd"]), note("Breakfast", "Breakfast options", ["poha", "oats"]), note("Movies", "Movies to watch", ["Interstellar"])]
  it("finds a list by name, alias or words", () => {
    expect(resolveList("shopping", lists)?.collection).toBe("Shopping")
    expect(resolveList("groceries", lists)?.collection).toBe("Shopping")
    expect(resolveList("breakfast", lists)?.collection).toBe("Breakfast")
    expect(resolveList("movies list", lists)?.collection).toBe("Movies")
    expect(resolveList("my day", lists)).toBeNull()
    expect(resolveList("goals", lists)).toBeNull()
  })
  it("knows the well-known lists", () => {
    expect(wellKnownList("groceries")).toEqual({ collection: "Shopping", title: "Shopping list" })
    expect(wellKnownList("random")).toBeNull()
  })
  it("finds one item or none", () => {
    expect(findListItem("milk", ["Milk", "curd"])).toBe("Milk")
    expect(findListItem("curd", ["Milk", "2 litres curd"])).toBe("2 litres curd")
    expect(findListItem("new job", ["Milk"])).toBeNull()
    expect(findListItem("milk", ["Milk (full cream)", "Almond milk"])).toBeNull() // two: not guessed
  })
})

describe("words", () => {
  it("answers plainly", () => {
    expect(addedReply("Shopping list", ["Milk", "Eggs"], [], 5)).toBe("Added Milk and Eggs to your shopping list. 5 items now.")
    expect(addedReply("Shopping list", [], ["Milk"], 3)).toBe("Milk is already on your shopping list.")
    expect(tickedReply("Shopping list", ["Milk"], 2)).toBe("Got Milk. 2 left on your shopping list.")
    expect(tickedReply("Shopping list", ["Milk"], 0)).toBe("Got Milk. Your shopping list is all ticked off.")
    const n = note("Shopping", "Shopping list", ["Milk", "Eggs", "Bread"], ["Eggs"])
    expect(openItems(n)).toEqual(["Milk", "Bread"])
    expect(showReply("Shopping list", n)).toBe("Shopping list (2 to go): Milk, Bread. Got: Eggs.")
    expect(showReply("Shopping list", note("Shopping", "Shopping list"))).toContain("empty")
  })
})

describe("routines (D4)", () => {
  it("sets a routine", () => {
    expect(listIntent("my gym routine: bench press 3x10, squats 3x8 and rows")).toEqual({ kind: "SET_ROUTINE", name: "gym", items: ["Bench press 3x10", "Squats 3x8", "Rows"] })
    expect(listIntent("set my morning routine - water, stretch, journal")).toEqual({ kind: "SET_ROUTINE", name: "morning", items: ["Water", "Stretch", "Journal"] })
  })
  it("ticks a step with done, resets and shows", () => {
    expect(listIntent("done bench press")).toEqual({ kind: "TICK", items: ["Bench press"], list: null })
    expect(listIntent("finished the squats")).toEqual({ kind: "TICK", items: ["Squats"], list: null })
    expect(listIntent("Done: Gym session")).toBeNull() // the app's own button text is not a list message
    expect(listIntent("start my gym routine")).toEqual({ kind: "RESET", list: "gym" })
    expect(listIntent("reset the morning routine")).toEqual({ kind: "RESET", list: "morning" })
    expect(listIntent("my gym routine")).toEqual({ kind: "SHOW", list: "gym" })
    expect(listIntent("show my gym routine")).toEqual({ kind: "SHOW", list: "gym" })
  })
  it("finds a routine by its short name", () => {
    const lists = [note("Gym", "Gym routine", ["Bench press 3x10", "Squats 3x8"]), note("Shopping", "Shopping list")]
    expect(resolveList("gym", lists)?.collection).toBe("Gym")
    expect(resolveList("gym routine", lists)?.collection).toBe("Gym")
    expect(findListItem("bench press", lists[0]!.items)).toBe("Bench press 3x10")
  })
})
