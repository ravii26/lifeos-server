import { beforeEach, describe, expect, it } from "vitest"
import { callWithRetry, isDeadError, isTransientError, resetDeadProviders } from "./ai-fallback.js"

const noSleep = async () => {}

describe("which AI errors are worth retrying", () => {
  it("temporary ones are", () => {
    expect(isTransientError(new Error("[GoogleGenerativeAI Error]: [503 Service Unavailable] This model is currently experiencing high demand"))).toBe(true)
    expect(isTransientError(new Error("429 Too Many Requests"))).toBe(true)
    expect(isTransientError(new Error("fetch failed"))).toBe(true)
    expect(isTransientError(new Error("request timed out"))).toBe(true)
  })
  it("a bad key, no balance or a refusal are not", () => {
    for (const m of [
      '401 {"error":{"message":"Invalid API Key","code":"expired_api_key"}}',
      "AICredits failed on every model: google/gemini-3.5-flash-lite (402): insufficient balance: prompt costs ~₹0.02 but balance is ₹0.01",
      "403 permission denied",
    ]) {
      expect(isTransientError(new Error(m)), m).toBe(false)
      expect(isDeadError(new Error(m)), m).toBe(true)
    }
  })
  it("an ordinary failure is neither", () => {
    expect(isTransientError(new Error("could not parse the JSON"))).toBe(false)
    expect(isDeadError(new Error("could not parse the JSON"))).toBe(false)
  })
})

describe("retrying a temporary error", () => {
  beforeEach(() => resetDeadProviders())

  it("tries again and returns the first success", async () => {
    let calls = 0
    const out = await callWithRetry(async () => {
      calls++
      if (calls < 3) throw new Error("503 Service Unavailable")
      return "plan"
    }, [1, 1], noSleep)
    expect(out).toBe("plan")
    expect(calls).toBe(3)
  })
  it("gives up after the retries and passes the error on", async () => {
    let calls = 0
    await expect(callWithRetry(async () => { calls++; throw new Error("503 busy") }, [1, 1], noSleep)).rejects.toThrow("503")
    expect(calls).toBe(3) // first try + 2 retries
  })
  it("does not retry a dead key or an ordinary error", async () => {
    let calls = 0
    await expect(callWithRetry(async () => { calls++; throw new Error("401 Invalid API Key") }, [1, 1], noSleep)).rejects.toThrow("401")
    expect(calls).toBe(1)
    calls = 0
    await expect(callWithRetry(async () => { calls++; throw new Error("bad json") }, [1, 1], noSleep)).rejects.toThrow("bad json")
    expect(calls).toBe(1)
  })
  it("waits between tries", async () => {
    const waits: number[] = []
    let calls = 0
    await callWithRetry(async () => { if (++calls < 3) throw new Error("503"); return 1 }, [10, 20], async (ms) => { waits.push(ms) })
    expect(waits).toEqual([10, 20])
  })
})
