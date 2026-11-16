import { describe, it, expect } from "vitest"
import { splitDump, parseDumpJson, groupOf, timeCheck, hoursText } from "./dump.rules.js"

describe("splitDump (no AI)", () => {
  it("splits a messy Hinglish dump into separate things and drops the feelings", () => {
    const items = splitDump("so much to do. need to fix the geyser, call mom kal and pay electricity bill\nmujhe resume update karna hai; also start DSA")
    expect(items.map((i) => i.title)).toEqual(["Fix the geyser", "Call mom kal", "Pay electricity bill", "Resume update karna hai", "Start DSA"])
    expect(items.find((i) => i.title === "Call mom kal")?.soon).toBe(true)
    expect(items.find((i) => i.title === "Start DSA")?.soon).toBe(false)
  })

  it("never repeats a thing and caps a huge dump", () => {
    expect(splitDump("gym, Gym, gym.").length).toBe(1)
    expect(splitDump(Array.from({ length: 40 }, (_, i) => `task number ${i}`).join("\n")).length).toBe(25)
  })
})

describe("parseDumpJson", () => {
  const ctx = { areaIds: new Set(["career"]), todayKey: "2026-11-13" }

  it("keeps only valid fields: real future dates, sane minutes, own areas", () => {
    const raw = JSON.stringify({
      items: [
        { title: "Book exam date", due: "2026-11-20", minutes: 10, areaId: "career", soon: false },
        { title: "Pay rent", due: "2026-10-01", minutes: 9999, areaId: "someone-else", soon: true },
        { title: "x" },
        { title: "Book exam date" },
      ],
    })
    expect(parseDumpJson(raw, ctx)).toEqual([
      { title: "Book exam date", due: "2026-11-20", dueKind: "ON", windowFrom: null, windowTo: null, minutes: 10, areaId: "career", soon: false },
      { title: "Pay rent", due: null, dueKind: null, windowFrom: null, windowTo: null, minutes: null, areaId: null, soon: true },
    ])
  })

  it("reads when: by a day from the person's words, hours from the AI or the words", () => {
    const raw = JSON.stringify({
      items: [
        { title: "Send the resume", said: "send the resume by Friday", due: "2026-11-20" },
        { title: "Go running", said: "go running 6 to 8 am" },
        { title: "Guitar practice", from: "19:00", to: "20:00" },
      ],
    })
    expect(parseDumpJson(raw, ctx)).toMatchObject([
      { title: "Send the resume", due: "2026-11-20", dueKind: "BY" },
      { title: "Go running", due: null, windowFrom: "06:00", windowTo: "08:00" },
      { title: "Guitar practice", windowFrom: "19:00", windowTo: "20:00" },
    ])
  })

  it("without AI, when is read from each line and taken out of the name", () => {
    expect(splitDump("call the bank tomorrow; run 6 to 8 am; study between 6 and 8 pm", ctx.todayKey)).toMatchObject([
      { title: "Call the bank", dueKind: "ON" },
      { title: "Run", windowFrom: "06:00", windowTo: "08:00" },
      { title: "Study", windowFrom: "18:00", windowTo: "20:00" },
    ])
  })

  it("returns nothing for broken JSON, so the plain-code split takes over", () => {
    expect(parseDumpJson("not json", ctx)).toEqual([])
  })
})

describe("sorting and the time check", () => {
  it("sorts by code: a date wins, then this week, then can wait", () => {
    expect(groupOf({ due: "2026-11-20", soon: false })).toBe("DATED")
    expect(groupOf({ due: null, soon: true })).toBe("THIS_WEEK")
    expect(groupOf({ due: null, soon: false })).toBe("LATER")
  })

  it("fits only within 70% of free time, and says so plainly when it doesn't", () => {
    expect(timeCheck(6 * 60, 11 * 60).fits).toBe(true)
    const over = timeCheck(31 * 60, 11 * 60)
    expect(over.fits).toBe(false)
    expect(over.line).toBe("All of this needs about 31 h a week. You have about 11 h free. It can't all happen at once, and that's not laziness. Let's make it fit.")
    expect(timeCheck(9 * 60, 11 * 60).fits).toBe(false) // 9 h > 70% of 11 h
  })

  it("rounds hours the way people say them", () => {
    expect(hoursText(25)).toBe("25 min")
    expect(hoursText(95)).toBe("1.5 h")
    expect(hoursText(600)).toBe("10 h")
  })
})
