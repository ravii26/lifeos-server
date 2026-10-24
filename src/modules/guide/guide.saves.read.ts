/* =====================================================================
   Reading what was saved (Phase D slice D7, ADR 0044): an article's text,
   and a PDF through Gemini (which reads PDFs natively, so no extra library).
   Every fetch is made by safeFetch, which refuses private addresses at each
   redirect hop. If a page needs a login or is paywalled it is reported as
   blocked and never summarised.
   ===================================================================== */
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import logger from "../../lib/logger.js"
import { extractArticleText, isFetchableUrl, looksBlocked, readingMinutes } from "./saves.type.rules.js"

const MAX_HOPS = 3
const MAX_BYTES = 3 * 1024 * 1024

// fetch with a timeout that follows at most 3 redirects, checking each target.
export const safeFetch = async (url: string, ms: number): Promise<Response | null> => {
  let current = url
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isFetchableUrl(current)) return null
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ms)
    try {
      const res = await fetch(current, { signal: ctrl.signal, redirect: "manual", headers: { "User-Agent": "Ally/1.0 (+link preview)", Accept: "text/html,text/plain" } })
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location")
        if (!next) return null
        current = new URL(next, current).toString()
        continue
      }
      return res
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

export interface ArticleRead {
  text: string
  blocked: boolean
  minutes: number
}

// The text of a web page that is an article. Null when it cannot be fetched or is not a page.
export const readArticle = async (url: string): Promise<ArticleRead | null> => {
  try {
    const res = await safeFetch(url, 6000)
    if (!res || !res.ok) return null
    const type = res.headers.get("content-type") ?? ""
    if (!type.includes("text/html") && !type.includes("text/plain")) return null
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null
    const html = (await res.text()).slice(0, MAX_BYTES)
    const text = type.includes("text/plain") ? html.trim() : extractArticleText(html)
    if (!text) return { text: "", blocked: true, minutes: 0 }
    return { text, blocked: looksBlocked(text), minutes: readingMinutes(text) }
  } catch (err) {
    logger.info(`Article read skipped for ${url}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

const PDF_TIMEOUT_MS = 90_000
const PDF_MAX_BYTES = 18 * 1024 * 1024
export const PDF_TEXT_CHARS = 60_000

// The text of a PDF (a book chapter, notes, an article), read by Gemini. Null without a key, for a
// file that is too large, or when it cannot be read; the save then says so.
export const readPdfText = async (buffer: Buffer): Promise<string | null> => {
  if (!geminiClient || buffer.length > PDF_MAX_BYTES) return null
  try {
    const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL })
    const call = model.generateContent([
      { inlineData: { mimeType: "application/pdf", data: buffer.toString("base64") } },
      { text: "Write out the readable text of this document in order, as plain text with no commentary and no formatting marks. Do not summarise. Stop after about 60000 characters." },
    ])
    const result = await Promise.race([call, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pdf read timed out")), PDF_TIMEOUT_MS))])
    const text = result.response.text().trim()
    return text.length >= 80 ? text.slice(0, PDF_TEXT_CHARS) : null
  } catch (err) {
    logger.info(`PDF read skipped: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
