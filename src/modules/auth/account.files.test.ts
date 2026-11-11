import path from "node:path"
import { describe, expect, it } from "vitest"
import { uploadPathOf } from "./account.service.js"

describe("finding uploaded files when an account is deleted", () => {
  const root = path.resolve("/data/uploads")
  it("maps a stored link to its file", () => {
    expect(uploadPathOf("/uploads/captures/a.webm", root)).toBe(path.join(root, "captures", "a.webm"))
  })
  it("never leaves the uploads folder", () => {
    for (const bad of ["/uploads/../../etc/passwd", "/uploads/..", "https://x.com/a.png", null, undefined, ""]) expect(uploadPathOf(bad, root), String(bad)).toBeNull()
  })
})
