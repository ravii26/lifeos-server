import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The env is read once at import, so each test sets it first and imports fresh.
const load = async (env: Record<string, string> = {}) => {
  vi.resetModules()
  vi.stubEnv("AICREDITS_API_KEY", "test-key")
  // Your own .env may prefer a provider; these tests start from "nothing preferred".
  vi.stubEnv("PREFERRED_AI_PROVIDER", "")
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return {
    credits: await import("./aicredits.js"),
    fallback: await import("./ai-fallback.js"),
    groq: await import("./groq.js"),
  }
}

const ok = (content: string, extra: object = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 }, ...extra }), { status: 200 })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("AICredits client", () => {
  it("calls the OpenAI-compatible endpoint with the key and the messages", async () => {
    const { credits } = await load()
    fetchMock.mockResolvedValueOnce(ok('{"a":1}'))
    const r = await credits.aiCreditsChat({ messages: [{ role: "user", content: "hi" }], response_format: { type: "json_object" } })
    expect(r.choices[0]!.message.content).toBe('{"a":1}')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://api.aicredits.in/v1/chat/completions")
    expect(init.headers.Authorization).toBe("Bearer test-key")
    const body = JSON.parse(init.body)
    expect(body.messages).toEqual([{ role: "user", content: "hi" }])
    expect(body.response_format).toEqual({ type: "json_object" })
    expect(body.model).toBe("google/gemini-3.5-flash-lite")
  })

  it("moves to the next model when one fails or is out of credits", async () => {
    const { credits } = await load()
    fetchMock.mockResolvedValueOnce(new Response("no credits", { status: 402 })).mockResolvedValueOnce(ok("second"))
    const r = await credits.aiCreditsChat({ messages: [{ role: "user", content: "x" }] })
    expect(r.choices[0]!.message.content).toBe("second")
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).model).toBe("openai/gpt-4o-mini")
  })

  it("treats a JSON reply cut off at the length limit as a failure and tries the next model", async () => {
    const { credits } = await load()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"cut' }, finish_reason: "length" }] }), { status: 200 }))
      .mockResolvedValueOnce(ok('{"whole":true}'))
    const r = await credits.aiCreditsChat({ messages: [], response_format: { type: "json_object" } })
    expect(r.choices[0]!.message.content).toBe('{"whole":true}')
  })

  it("throws one error naming every attempt when all models fail", async () => {
    const { credits } = await load()
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }))
    await expect(credits.aiCreditsChat({ messages: [] })).rejects.toThrow(/gemini-3.5-flash-lite.*503.*gpt-4o-mini.*503.*claude-haiku/s)
  })

  it("uses the models from AICREDITS_MODELS when set", async () => {
    const { credits } = await load({ AICREDITS_MODELS: "deepseek/deepseek-v4-flash" })
    fetchMock.mockResolvedValueOnce(ok("x"))
    await credits.aiCreditsChat({ messages: [] })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).model).toBe("deepseek/deepseek-v4-flash")
  })

  it("stops at the daily call limit so credits cannot run away", async () => {
    const { credits } = await load({ AICREDITS_DAILY_CALL_LIMIT: "2" })
    fetchMock.mockImplementation(async () => ok("x"))
    await credits.aiCreditsChat({ messages: [] })
    await credits.aiCreditsChat({ messages: [] })
    expect(credits.aiCreditsAllowed()).toBe(false)
    await expect(credits.aiCreditsChat({ messages: [] })).rejects.toThrow(/daily call limit/)
  })
})

describe("provider order", () => {
  it("AICredits first when configured and nothing is preferred, then Gemini, then Groq", async () => {
    const { fallback } = await load()
    const all = { aicredits: true, gemini: true, groq: true }
    expect(fallback.providerOrder(undefined, all)).toEqual(["aicredits", "gemini", "groq"])
  })
  it("keeps the old default (Groq first) when AICredits is not available", async () => {
    const { fallback } = await load()
    expect(fallback.providerOrder(undefined, { aicredits: false, gemini: true, groq: true })).toEqual(["groq", "gemini"])
  })
  it("an explicit preference wins, the rest follow in the fixed order", async () => {
    const { fallback } = await load()
    const all = { aicredits: true, gemini: true, groq: true }
    expect(fallback.providerOrder("gemini", all)).toEqual(["gemini", "aicredits", "groq"])
    expect(fallback.providerOrder("groq", all)).toEqual(["groq", "aicredits", "gemini"])
  })
  it("leaves out what is not available", async () => {
    const { fallback } = await load()
    expect(fallback.providerOrder("aicredits", { aicredits: false, gemini: true, groq: false })).toEqual(["gemini"])
  })
})

describe("running the existing Groq-style functions through AICredits", () => {
  it("the same function reaches AICredits first, with no change at the call site", async () => {
    const { fallback, groq } = await load({ GROQ_API_KEY: "g-key" })
    fetchMock.mockResolvedValueOnce(ok("from credits"))
    // A call site exactly as written for Groq:
    const viaGroq = async () => {
      const res = await groq.groqClient!.chat.completions.create({ messages: [{ role: "user", content: "q" }], model: "openai/gpt-oss-120b" } as never)
      return res.choices[0]!.message.content as string
    }
    const gemini = vi.fn().mockResolvedValue("from gemini")
    const out = await fallback.runWithAiFallback("test", { gemini, groq: viaGroq }, () => "heuristic")
    expect(out).toBe("from credits")
    expect(gemini).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.aicredits.in/v1/chat/completions")
  })

  it("falls through to Gemini when AICredits and Groq both fail, then to the heuristic", async () => {
    const { fallback, groq } = await load({ GROQ_API_KEY: "g-key" })
    fetchMock.mockResolvedValue(new Response("402", { status: 402 }))
    const viaGroq = async () => {
      await groq.groqClient!.chat.completions.create({ messages: [] } as never)
      return "x"
    }
    const gemini = vi.fn().mockResolvedValue("from gemini")
    expect(await fallback.runWithAiFallback("test", { gemini, groq: viaGroq }, () => "heuristic")).toBe("from gemini")
    const failing = vi.fn().mockRejectedValue(new Error("down"))
    expect(await fallback.runWithAiFallback("test", { gemini: failing, groq: viaGroq }, () => "heuristic")).toBe("heuristic")
  })

  it("with only an AICredits key (no Groq), the Groq-shaped call sites still work and Groq is never tried", async () => {
    vi.resetModules()
    vi.stubEnv("GROQ_API_KEY", "")
    vi.stubEnv("AICREDITS_API_KEY", "test-key")
    const fallback = await import("./ai-fallback.js")
    const groq = await import("./groq.js")
    expect(groq.groqClient).not.toBeNull()
    fetchMock.mockResolvedValueOnce(ok("only credits"))
    const viaGroq = async () => (await groq.groqClient!.chat.completions.create({ messages: [] } as never)).choices[0]!.message.content as string
    expect(await fallback.runWithAiFallback("test", { groq: viaGroq }, () => "heuristic")).toBe("only credits")
    expect(() => groq.groqClient!.audio).toThrow(/Groq/)
  })
})
