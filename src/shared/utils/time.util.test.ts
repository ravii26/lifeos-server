import { describe, expect, it } from "vitest"
import {
  addUtcDays,
  dateFromKey,
  dayKeyInTz,
  daysBetweenKeys,
  hourInTz,
  localDateOnly,
  localDayStartMs,
  timeOfDayLabel,
  todayKeyInTz,
  tzOffsetMinutes,
  utcDayKey,
  weekdayInTz,
} from "./time.util.js"

describe("utcDayKey", () => {
  it("truncates a UTC instant to its calendar day", () => {
    expect(utcDayKey(new Date("2026-07-12T23:59:00.000Z"))).toBe("2026-07-12")
    expect(utcDayKey(new Date("2026-07-12T00:00:00.000Z"))).toBe("2026-07-12")
  })
})

describe("dayKeyInTz", () => {
  it("computes the local calendar day, which can differ from UTC", () => {
    // 2026-07-12T02:00 UTC is still 2026-07-11 evening in US/Pacific (UTC-7 in July, DST).
    const instant = new Date("2026-07-12T02:00:00.000Z")
    expect(dayKeyInTz(instant, "UTC")).toBe("2026-07-12")
    expect(dayKeyInTz(instant, "America/Los_Angeles")).toBe("2026-07-11")
  })
})

describe("todayKeyInTz", () => {
  it("matches dayKeyInTz for the given instant", () => {
    const instant = new Date("2026-01-15T10:00:00.000Z")
    expect(todayKeyInTz("UTC", instant)).toBe(dayKeyInTz(instant, "UTC"))
  })
})

describe("hourInTz", () => {
  it("returns the local hour (0-23) for the timezone", () => {
    const instant = new Date("2026-07-12T18:30:00.000Z")
    expect(hourInTz("UTC", instant)).toBe(18)
    // Asia/Kolkata is UTC+5:30 — 18:30 UTC -> 00:00 local the next day.
    expect(hourInTz("Asia/Kolkata", instant)).toBe(0)
  })
})

describe("timeOfDayLabel", () => {
  it.each([
    [3, "night"],
    [8, "morning"],
    [14, "afternoon"],
    [19, "evening"],
  ])("hour %i -> %s", (hour, label) => {
    const instant = new Date(Date.UTC(2026, 0, 1, hour))
    expect(timeOfDayLabel("UTC", instant)).toBe(label)
  })
})

describe("weekdayInTz", () => {
  it("returns the long weekday name", () => {
    // 2026-07-12 is a Sunday.
    expect(weekdayInTz("UTC", new Date("2026-07-12T12:00:00.000Z"))).toBe("Sunday")
  })
})

describe("dateFromKey / addUtcDays / daysBetweenKeys", () => {
  it("round-trips a day key through midnight-UTC arithmetic", () => {
    const d = dateFromKey("2026-07-12")
    expect(d.toISOString()).toBe("2026-07-12T00:00:00.000Z")
    expect(utcDayKey(addUtcDays(d, 3))).toBe("2026-07-15")
  })

  it("computes whole-day differences between keys", () => {
    expect(daysBetweenKeys("2026-07-12", "2026-07-15")).toBe(3)
    expect(daysBetweenKeys("2026-07-15", "2026-07-12")).toBe(-3)
  })
})

describe("localDateOnly", () => {
  it("anchors an instant to its local calendar day at midnight UTC", () => {
    const instant = new Date("2026-07-12T02:00:00.000Z")
    const result = localDateOnly(instant, "America/Los_Angeles")
    expect(result.toISOString()).toBe("2026-07-11T00:00:00.000Z")
  })
})

describe("tzOffsetMinutes", () => {
  it("returns 0 for UTC", () => {
    expect(tzOffsetMinutes(new Date("2026-07-12T12:00:00.000Z"), "UTC")).toBe(0)
  })

  it("returns the positive east-of-UTC offset for Asia/Kolkata (+5:30)", () => {
    expect(tzOffsetMinutes(new Date("2026-07-12T12:00:00.000Z"), "Asia/Kolkata")).toBe(330)
  })
})

describe("localDayStartMs", () => {
  it("matches the UTC midnight instant when timezone is UTC", () => {
    expect(localDayStartMs("2026-07-12", "UTC")).toBe(
      Date.parse("2026-07-12T00:00:00.000Z"),
    )
  })

  it("shifts earlier for a positive (east) offset like Asia/Kolkata", () => {
    const ms = localDayStartMs("2026-07-12", "Asia/Kolkata")
    // Local midnight in a UTC+5:30 zone is 18:30 UTC the previous day.
    expect(new Date(ms).toISOString()).toBe("2026-07-11T18:30:00.000Z")
  })
})
