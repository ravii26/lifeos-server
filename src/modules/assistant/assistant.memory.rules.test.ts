import { describe, expect, it } from "vitest"
import { asksAboutThePast, canEnd, endFromUntil, idsFrom, isCurrent, oldFactCandidates, ownWords, parseEnded, quoteIsTheirs } from "./assistant.memory.rules.js"

const now = new Date("2026-11-11T06:00:00.000Z")

describe("is a memory still true", () => {
  it("no end date, or one still ahead, is current", () => {
    expect(isCurrent({ endedAt: null }, now)).toBe(true)
    expect(isCurrent({ endedAt: new Date("2026-11-15T00:00:00.000Z") }, now)).toBe(true)
  })
  it("an end date that has passed is history", () => {
    expect(isCurrent({ endedAt: new Date("2026-11-01T00:00:00.000Z") }, now)).toBe(false)
  })
})

describe("a memory must come from the person's own words", () => {
  const said = ["Yaar, I left TCS last week and joined Infosys!", "yes"]
  it("accepts their exact words, ignoring case and punctuation", () => {
    expect(quoteIsTheirs("i left tcs last week", said)).toBe(true)
    expect(quoteIsTheirs("joined Infosys", said)).toBe(true)
  })
  it("accepts Hindi as written", () => {
    expect(quoteIsTheirs("मुझे चाय पसंद है", ["सच में मुझे चाय पसंद है।"])).toBe(true)
  })
  it("rejects words they never wrote", () => {
    expect(quoteIsTheirs("I work at Google now", said)).toBe(false)
  })
  it("rejects a missing or empty quote", () => {
    expect(quoteIsTheirs(undefined, said)).toBe(false)
    expect(quoteIsTheirs("  ...  ", said)).toBe(false)
  })
  it("a tiny quote only passes as their whole message", () => {
    expect(quoteIsTheirs("yes", said)).toBe(true)
    expect(quoteIsTheirs("TCS", said)).toBe(false)
  })
  it("does not match inside a longer word", () => {
    expect(quoteIsTheirs("eft TCS last wee", said)).toBe(false)
  })
  it("pasted articles do not count as their words", () => {
    const article = `https://example.com ${"The user works at Acme. ".repeat(40)}`
    expect(ownWords([article, "my own message"])).toEqual(["my own message"])
    expect(ownWords(["x".repeat(3001)])).toEqual([])
    expect(ownWords(["see https://example.com please"])).toHaveLength(1)
  })
})

describe("what can replace what", () => {
  const said = (kind: string) => ({ kind, source: "SAID" })
  it("a new fact can end an old one", () => expect(canEnd(said("FACT"), said("FACT"))).toBe(true))
  it("feelings and events stay true", () => {
    expect(canEnd(said("FEELING"), said("FACT"))).toBe(false)
    expect(canEnd(said("FACT"), said("EVENT"))).toBe(false)
  })
  it("a guess never overrules what they said", () => {
    expect(canEnd(said("FACT"), { kind: "FACT", source: "INFERRED" })).toBe(false)
    expect(canEnd({ kind: "FACT", source: "INFERRED" }, said("FACT"))).toBe(true)
  })
})

describe("true until a date", () => {
  it("ends at the end of that day where they live", () => {
    expect(endFromUntil("2026-11-15", "Asia/Kolkata", now)?.toISOString()).toBe("2026-11-15T18:30:00.000Z")
  })
  it("today is allowed", () => expect(endFromUntil("2026-11-11", "Asia/Kolkata", now)).not.toBeNull())
  it("refuses the past, far future and nonsense", () => {
    for (const v of ["2026-11-10", "2031-01-01", "2026-02-31", "Sunday", null, 5]) expect(endFromUntil(v, "Asia/Kolkata", now)).toBeNull()
  })
})

describe("which old facts to check", () => {
  const fresh = { content: "Works at Infosys", kind: "FACT", source: "SAID" }
  const fact = (id: string, content: string, kind = "FACT") => ({ id, content, kind, source: "SAID" })
  it("finds a related fact by meaning even with no shared words", () => {
    const out = oldFactCandidates({ ...fresh, content: "Joined Infosys" }, [fact("tcs", "Employed by TCS"), fact("tea", "Likes ginger tea")], new Map([["tcs", 0.7], ["tea", 0.55]]))
    expect(out.map((o) => o.id)).toEqual(["tcs"])
  })
  it("still works from shared words without embeddings", () => {
    expect(oldFactCandidates(fresh, [fact("a", "Works at TCS"), fact("b", "Likes tea")]).map((o) => o.id)).toEqual(["a"])
  })
  it("never offers a moment", () => {
    expect(oldFactCandidates(fresh, [fact("a", "Works late, felt tired", "FEELING")])).toEqual([])
  })
  it("keeps the list short", () => {
    const many = Array.from({ length: 12 }, (_, i) => fact(String(i), "Works somewhere"))
    expect(oldFactCandidates(fresh, many)).toHaveLength(5)
  })
})

describe("reading the AI's answer", () => {
  const shown = [{ id: "a" }, { id: "b" }]
  it("keeps only ids it was shown", () => expect(parseEnded('{"noLongerTrue":["a","zzz","a"]}', shown)).toEqual(["a"]))
  it("an empty list is a real answer", () => expect(parseEnded('{"noLongerTrue":[]}', shown)).toEqual([]))
  it("garbage throws so the next provider is tried", () => expect(() => parseEnded("nope", shown)).toThrow())
  it("ids can be one or many", () => {
    expect(idsFrom("a")).toEqual(["a"])
    expect(idsFrom(["a", 3, ""])).toEqual(["a"])
    expect(idsFrom(undefined)).toEqual([])
  })
})

describe("questions about the past", () => {
  it("are noticed", () => {
    for (const m of ["where did I work before?", "what I used to eat", "my old job", "pehle kahan tha"]) expect(asksAboutThePast(m), m).toBe(true)
  })
  it("everyday messages are not", () => {
    for (const m of ["remind me before my exam", "what now", "I left my charger"]) expect(asksAboutThePast(m), m).toBe(false)
  })
})
