import type { Memory } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const create = vi.fn()
const endMemories = vi.fn()
const checkOldFacts = vi.fn()

vi.mock("../../lib/prisma.js", () => ({ default: { memory: { create: (a: unknown) => create(a) } } }))
vi.mock("../activity/activity.service.js", () => ({ recordActivity: async () => ({ id: "event" }) }))
vi.mock("./assistant.memory.semantic.js", () => ({ embedMemory: async () => null }))
vi.mock("./assistant.profile.js", () => ({ clearProfile: async () => undefined }))
vi.mock("./assistant.memory.truth.js", () => ({
  endMemories: (...a: unknown[]) => endMemories(...a),
  checkOldFacts: (...a: unknown[]) => checkOldFacts(...a),
}))

const { saveMemories } = await import("./assistant.memory.js")

const old = (id: string, content: string, over: Partial<Memory> = {}) => ({ id, content, kind: "FACT", source: "SAID", ...over }) as Memory
const said = ["I left TCS and joined Infosys"]
const write = { content: "Works at Infosys", kind: "FACT", source: "SAID", quote: "joined Infosys" }

beforeEach(() => {
  vi.clearAllMocks()
  create.mockImplementation(async ({ data }: { data: object }) => ({ id: "new", ...data }))
})

describe("saving a memory", () => {
  it("keeps the person's words with it", async () => {
    const saved = await saveMemories("u", [write], [], said)
    expect(saved).toHaveLength(1)
    expect(create.mock.calls[0]![0].data.quote).toBe("joined Infosys")
  })

  it("drops a memory whose words they never wrote", async () => {
    expect(await saveMemories("u", [{ ...write, quote: "I work at Google" }], [], said)).toEqual([])
    expect(await saveMemories("u", [{ content: "Works at Infosys", kind: "FACT" }], [], said)).toEqual([])
    expect(create).not.toHaveBeenCalled()
  })

  it("retires what the model says it replaces, and skips the wider check", async () => {
    const tcs = old("tcs", "Works at TCS")
    await saveMemories("u", [{ ...write, replaces: ["tcs"] }], [tcs], said)
    expect(endMemories).toHaveBeenCalledWith("u", [tcs], "new")
    expect(checkOldFacts).not.toHaveBeenCalled()
  })

  it("ignores ids that are not this person's current memories", async () => {
    await saveMemories("u", [{ ...write, replaces: ["someone-elses"] }], [old("tcs", "Works at TCS")], said)
    expect(endMemories).not.toHaveBeenCalled()
    expect(checkOldFacts).toHaveBeenCalledOnce()
  })

  it("a guess cannot retire something they said", async () => {
    await saveMemories("u", [{ ...write, source: "INFERRED", replaces: ["tcs"] }], [old("tcs", "Works at TCS")], said)
    expect(endMemories).not.toHaveBeenCalled()
  })

  it("something true for a while ends on its date and replaces nothing", async () => {
    const until = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
    await saveMemories("u", [{ content: "In Goa for the week", kind: "FACT", source: "SAID", quote: "in Goa till Sunday", until, replaces: ["home"] }], [old("home", "Lives in Mumbai")], ["I am in Goa till Sunday"])
    expect(create.mock.calls[0]![0].data.endedAt).toBeInstanceOf(Date)
    expect(endMemories).not.toHaveBeenCalled()
    expect(checkOldFacts).not.toHaveBeenCalled()
  })

  it("a fact that became true again can be saved again", async () => {
    expect(await saveMemories("u", [write], [], said)).toHaveLength(1)
  })
})
