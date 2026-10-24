import { describe, expect, it } from "vitest"
import {
  isFetchableUrl,
  choiceFor,
  cleanContentType,
  cleanDomain,
  extractArticleText,
  listFor,
  looksBlocked,
  readingMinutes,
  sampleLongText,
  suggestionReason,
} from "./saves.type.rules.js"

describe("choiceFor and listFor", () => {
  it("suggests by kind of content", () => {
    expect(choiceFor("WORKOUT", null)).toBe("DO")
    expect(choiceFor("RECIPE", null)).toBe("DO")
    expect(choiceFor("COURSE", 180)).toBe("LATER")
    expect(choiceFor("TUTORIAL", 12)).toBe("DO")
    expect(choiceFor("TUTORIAL", 45)).toBe("LATER")
    expect(choiceFor("TUTORIAL", null)).toBe("DO")
    expect(choiceFor("MOTIVATION", null)).toBe("LIFT")
    expect(choiceFor("RECOMMENDATION", null)).toBe("LIST")
    expect(choiceFor("PRODUCT", null)).toBe("LIST")
    expect(choiceFor("NEWS", null)).toBe("LATER")
    expect(choiceFor("FUN", null)).toBe("LET_GO")
  })
  it("picks the list a pick belongs on", () => {
    expect(listFor("PLACE", "travel", "cafe in Pune")).toBe("Places")
    expect(listFor("PRODUCT", "other", "headphones")).toBe("Wishlist")
    expect(listFor("RECOMMENDATION", "fun", "5 movies to watch this winter")).toBe("Movies")
    expect(listFor("RECOMMENDATION", "learning", "5 books every engineer should read")).toBe("Books")
    expect(listFor("WORKOUT", "fitness", "abs")).toBeNull()
  })
  it("cleans what the model says", () => {
    expect(cleanContentType("recipe")).toBe("RECIPE")
    expect(cleanContentType("pizza")).toBeNull()
    expect(cleanContentType(5)).toBeNull()
    expect(cleanDomain("Fitness")).toBe("fitness")
    expect(cleanDomain("whatever")).toBe("other")
  })
  it("says why in plain words", () => {
    expect(suggestionReason("FUN", "LET_GO", null)).toBe("Nothing to do here. Let it go?")
    expect(suggestionReason("RECOMMENDATION", "LIST", "Movies")).toBe("A pick to keep on your movies list.")
  })
})

describe("reading time and long text", () => {
  it("estimates minutes at 200 words a minute", () => {
    expect(readingMinutes("word ".repeat(1000))).toBe(5)
    expect(readingMinutes("a few words")).toBe(1)
  })
  it("reads up to 30,000 characters whole and samples beyond", () => {
    const short = "a".repeat(29_000)
    expect(sampleLongText(short)).toEqual({ text: short, sampled: false })
    const long = "START" + "x".repeat(60_000) + "END"
    const out = sampleLongText(long)
    expect(out.sampled).toBe(true)
    expect(out.text.length).toBeLessThan(31_000)
    expect(out.text.startsWith("START")).toBe(true)
    expect(out.text.endsWith("END")).toBe(true)
    expect(out.text).toContain("[...]")
  })
})

describe("extractArticleText", () => {
  const page = `<html><head><title>T</title><script>var x = 1</script></head><body>
    <nav><a href="/">Home</a><a href="/about">About us and many other things in a long menu line</a></nav>
    <article><h1>Why sleep matters</h1>
      <p>Sleep is when your body repairs itself, and most adults need seven to nine hours a night to function well.</p>
      <p>Short   naps help &amp; do not replace a night&#39;s sleep for most people who try them.</p>
      <p>Too short</p>
      <style>.x{color:red}</style>
    </article><footer><p>Copyright 2026 Example Inc. All rights reserved worldwide.</p></footer></body></html>`
  it("keeps the article text, drops menus, scripts, footers and tiny fragments", () => {
    const text = extractArticleText(page)
    expect(text).toContain("Why sleep matters")
    expect(text).toContain("repairs itself")
    expect(text).toContain("Short naps help & do not replace a night's sleep")
    expect(text).not.toContain("Home")
    expect(text).not.toContain("Copyright")
    expect(text).not.toContain("var x")
    expect(text).not.toContain("Too short")
  })
  it("falls back to the body when there is no article tag", () => {
    expect(extractArticleText("<body><p>This is a long enough paragraph of real text for the reader to keep it.</p></body>")).toContain("long enough paragraph")
  })
  it("spots pages that could not be read", () => {
    expect(looksBlocked("Please subscribe to continue reading.")).toBe(true)
    expect(looksBlocked("word ".repeat(300))).toBe(false)
    expect(looksBlocked(`${"word ".repeat(300)} Sign in to continue reading this article`)).toBe(true)
  })
})

describe("isFetchableUrl", () => {
  it("allows public web pages", () => {
    expect(isFetchableUrl("https://www.youtube.com/watch?v=abc")).toBe(true)
    expect(isFetchableUrl("http://example.com/a/b?c=d")).toBe(true)
    expect(isFetchableUrl("https://8.8.8.8/x")).toBe(true)
  })
  it("refuses the server itself, private networks and odd schemes", () => {
    for (const bad of [
      "http://localhost:3000/admin",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://172.16.4.4/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata/",
      "http://service.internal/",
      "http://[::1]/",
      "ftp://example.com/file",
      "file:///etc/passwd",
      "https://user:pass@example.com/",
      "https://example.com:8080/",
      "not a url",
    ]) {
      expect(isFetchableUrl(bad), bad).toBe(false)
    }
  })
})
