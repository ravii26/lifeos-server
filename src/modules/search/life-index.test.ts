import { describe, expect, it } from "vitest"
import type { SearchHit, Searchable } from "./search.rules.js"
import { allowedKeys, fuseRankings, hashOf, indexText, nearest, planIndexChanges } from "./life-index.js"

const item = (kind: Searchable["kind"], id: string, title: string, body = ""): Searchable => ({ kind, id, title, body })
const hit = (kind: SearchHit["kind"], id: string, snippet = ""): SearchHit => ({ kind, id, title: id, snippet, score: 1 })

describe("keeping the life index in step", () => {
  it("adds new things, re-embeds changed ones, leaves unchanged ones, removes deleted ones", () => {
    const same = item("NOTE", "n1", "Breakfasts", "poha, oats")
    const changed = item("TASK", "t1", "Book the blood test", "go fasting")
    const added = item("SAVE", "s1", "DP in 12 minutes")
    const existing = [
      { id: "row-n1", kind: "NOTE", refId: "n1", hash: hashOf(indexText(same)) },
      { id: "row-t1", kind: "TASK", refId: "t1", hash: hashOf("old text") },
      { id: "row-gone", kind: "TASK", refId: "deleted", hash: "x" },
    ]
    const { upserts, removeIds } = planIndexChanges(existing, [same, changed, added])
    expect(upserts.map((u) => u.id).sort()).toEqual(["s1", "t1"])
    expect(removeIds).toEqual(["row-gone"])
  })

  it("the same id in two kinds is two different things", () => {
    const { upserts } = planIndexChanges([{ id: "r", kind: "NOTE", refId: "x", hash: hashOf(indexText(item("NOTE", "x", "a"))) }], [item("NOTE", "x", "a"), item("TASK", "x", "a")])
    expect(upserts.map((u) => u.kind)).toEqual(["TASK"])
  })

  it("long text is capped before hashing, so the hash is stable", () => {
    const long = item("NOTE", "n", "t", "x".repeat(5000))
    expect(indexText(long).length).toBe(2000)
    expect(hashOf(indexText(long))).toBe(hashOf(indexText({ ...long, body: "x".repeat(6000) })))
  })
})

describe("finding by meaning", () => {
  it("keeps only close matches, best first", () => {
    const rows = [
      { id: "a", embedding: [1, 0] },
      { id: "b", embedding: [0.8, 0.6] },
      { id: "c", embedding: [0, 1] },
      { id: "wrong-size", embedding: [1, 0, 0] },
    ]
    expect(nearest(rows, [1, 0], 5, 0.7).map((r) => r.id)).toEqual(["a", "b"])
  })

  it("only allows the person's current things", () => {
    expect(allowedKeys([item("NOTE", "n1", "a")]).has("NOTE:n1")).toBe(true)
    expect(allowedKeys([item("NOTE", "n1", "a")]).has("TASK:n1")).toBe(false)
  })
})

describe("fusing word and meaning results", () => {
  it("something both searches found beats something only one found", () => {
    const words = [hit("NOTE", "dsa", "from words"), hit("TASK", "gym")]
    const meaning = [hit("SAVE", "dp-video"), hit("NOTE", "dsa", "from meaning")]
    const fused = fuseRankings([words, meaning])
    expect(fused[0]!.id).toBe("dsa")
    expect(fused[0]!.snippet).toBe("from words")
    expect(fused.map((h) => h.id)).toContain("dp-video")
  })

  it("respects the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => hit("TASK", `t${i}`))
    expect(fuseRankings([many], 8)).toHaveLength(8)
  })
})
