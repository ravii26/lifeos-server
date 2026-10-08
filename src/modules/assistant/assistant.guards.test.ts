import { describe, expect, it } from "vitest"
import { projectAsTask } from "./assistant.guards.js"

describe("a project with one step is a to-do", () => {
  const resume = { type: "ADD_PROJECT", kind: "WORK", title: "Update resume", priority: "HIGH", deadline: "2026-10-12", tasks: [{ title: "Update my resume" }] }
  it("turns one errand into a to-do and keeps its date and priority", () => {
    expect(projectAsTask(resume, "I need to update my resume this week")).toEqual({
      type: "ADD_TASK", title: "Update my resume", due: "2026-10-12", priority: "HIGH", areaId: null,
    })
  })
  it("keeps real projects", () => {
    expect(projectAsTask({ ...resume, tasks: [{ title: "a" }, { title: "b" }] }, "I need to update my resume")).toBeNull()
    expect(projectAsTask({ ...resume, kind: "MILESTONE" }, "I want to switch jobs")).toBeNull()
    expect(projectAsTask({ ...resume, milestones: ["Resume", "Apply"] }, "x")).toBeNull()
    expect(projectAsTask({ ...resume, metric: { name: "Weight" } }, "x")).toBeNull()
    expect(projectAsTask({ ...resume, weeklyTargetMinutes: 150 }, "x")).toBeNull()
  })
  it("respects the word project", () => {
    expect(projectAsTask(resume, "Project A: API due Thursday")).toBeNull()
  })
  it("ignores other actions", () => {
    expect(projectAsTask({ type: "ADD_TASK" }, "x")).toBeNull()
  })
})
