import { describe, expect, it } from "vitest"
import { videoKey } from "./guide.saves.shared.js"
import { LEAN_VIDEO } from "./guide.saves.ai.js"

describe("one key per video, whatever the link looks like", () => {
  it("every YouTube form gives the same key", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=xyz",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
      "  https://music.youtube.com/watch?v=dQw4w9WgXcQ  ",
    ]) {
      expect(videoKey(url), url).toBe("yt:dQw4w9WgXcQ")
    }
  })

  it("anything else is not shared", () => {
    for (const url of ["https://www.instagram.com/reel/abc123/", "https://example.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=short", "not a link", "https://www.youtube.com/@channel"]) {
      expect(videoKey(url), url).toBeNull()
    }
  })
})

describe("watching cheaply", () => {
  it("low resolution, few frames, first 20 minutes", () => {
    expect(LEAN_VIDEO.mediaResolution).toBe("MEDIA_RESOLUTION_LOW")
    expect(LEAN_VIDEO.fps).toBeLessThanOrEqual(0.2)
    expect(LEAN_VIDEO.endOffset).toBe("1200s")
  })
})
