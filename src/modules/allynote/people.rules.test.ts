import { describe, expect, it } from "vitest"
import {
  cleanPhone,
  contactUrl,
  dateWords,
  dialNumber,
  displayName,
  findPerson,
  listReply,
  maskPhone,
  parseDayMonth,
  personIntent,
  type PersonNote,
} from "./people.rules.js"

describe("parseDayMonth", () => {
  it("reads the ways people write a birthday", () => {
    expect(parseDayMonth("12 March")).toEqual({ month: 3, day: 12 })
    expect(parseDayMonth("12th march")).toEqual({ month: 3, day: 12 })
    expect(parseDayMonth("March 12")).toEqual({ month: 3, day: 12 })
    expect(parseDayMonth("3rd of Jun")).toEqual({ month: 6, day: 3 })
    expect(parseDayMonth("12/03")).toEqual({ month: 3, day: 12 })
    expect(parseDayMonth("29 February")).toEqual({ month: 2, day: 29 })
  })
  it("rejects things that are not dates", () => {
    expect(parseDayMonth("31 April")).toBeNull()
    expect(parseDayMonth("someday soon")).toBeNull()
    expect(parseDayMonth("32 March")).toBeNull()
    expect(parseDayMonth("13/13")).toBeNull()
  })
})

describe("personIntent", () => {
  it("reads birthdays, numbers and questions", () => {
    expect(personIntent("Mom's birthday is 12 March")).toEqual({ kind: "BIRTHDAY", name: "Mom", month: 3, day: 12 })
    expect(personIntent("Priya birthday on 3rd June")).toEqual({ kind: "BIRTHDAY", name: "Priya", month: 6, day: 3 })
    expect(personIntent("remember that my sister's birthday is 5 Nov")).toEqual({ kind: "BIRTHDAY", name: "sister", month: 11, day: 5 })
    expect(personIntent("Priya's number is 98765 43210")).toEqual({ kind: "PHONE", name: "Priya", phone: "9876543210" })
    expect(personIntent("save Rahul's number +91 98111-22333")).toEqual({ kind: "PHONE", name: "Rahul", phone: "+919811122333" })
    expect(personIntent("when is Mom's birthday")).toEqual({ kind: "SHOW", name: "Mom", what: "BIRTHDAY" })
    expect(personIntent("what's Priya's number")).toEqual({ kind: "SHOW", name: "Priya", what: "PHONE" })
    expect(personIntent("my people")).toEqual({ kind: "LIST" })
  })
  it("reads call and WhatsApp", () => {
    expect(personIntent("call Priya")).toEqual({ kind: "CONTACT", mode: "CALL", name: "Priya" })
    expect(personIntent("WhatsApp Rahul")).toEqual({ kind: "CONTACT", mode: "WHATSAPP", name: "Rahul" })
    expect(personIntent("message Rahul on whatsapp")).toEqual({ kind: "CONTACT", mode: "WHATSAPP", name: "Rahul" })
    expect(personIntent("who is Priya")).toEqual({ kind: "SHOW", name: "Priya", what: "ALL" })
  })
  it("leaves other sentences alone", () => {
    expect(personIntent("hello")).toBeNull()
    expect(personIntent("Priya's number is unknown")).toBeNull()
    expect(personIntent("my birthday is coming up soon")).toBeNull() // no date
    expect(personIntent("my birthday is 5 June")).toBeNull() // the person themselves: a memory
    expect(personIntent("Priya's number is 123")).toBeNull() // too short
  })
})

describe("findPerson", () => {
  const people: PersonNote[] = [
    { id: "1", title: "Mom", meta: { phone: "9876543210" } },
    { id: "2", title: "Priya Sharma", meta: null },
    { id: "3", title: "Priya Iyer", meta: null },
    { id: "4", title: "Rahul", meta: null },
  ]
  it("finds by name, nickname group or a first name only one person has", () => {
    expect(findPerson("mom", people)?.id).toBe("1")
    expect(findPerson("Mother", people)?.id).toBe("1")
    expect(findPerson("rahul", people)?.id).toBe("4")
    expect(findPerson("Priya Sharma", people)?.id).toBe("2")
    expect(findPerson("Sharma", people)?.id).toBe("2")
  })
  it("does not guess between two people or an unknown name", () => {
    expect(findPerson("Priya", people)).toBeNull()
    expect(findPerson("Dad", people)).toBeNull()
    expect(findPerson("", people)).toBeNull()
  })
})

describe("links and words", () => {
  it("cleans and dials numbers", () => {
    expect(cleanPhone("98765 43210")).toBe("9876543210")
    expect(cleanPhone("+91 98111-22333")).toBe("+919811122333")
    expect(cleanPhone("12345")).toBeNull()
    expect(dialNumber("9876543210", "Asia/Kolkata")).toBe("+919876543210")
    expect(dialNumber("9876543210", "Europe/London")).toBe("9876543210")
    expect(contactUrl("CALL", "9876543210", "Asia/Kolkata")).toBe("tel:+919876543210")
    expect(contactUrl("WHATSAPP", "+919811122333", "Asia/Kolkata")).toBe("https://wa.me/919811122333")
  })
  it("says things without printing the number", () => {
    expect(maskPhone("9876543210")).toBe("ending 3210")
    expect(dateWords({ month: 3, day: 12 })).toBe("12 March")
    expect(displayName("my sister riya")).toBe("Sister Riya")
    expect(listReply([{ id: "1", title: "Mom", meta: { birthday: { month: 3, day: 12 }, phone: "9876543210" } }])).toBe("People (1): Mom (birthday 12 March, number saved).")
    expect(listReply([])).toContain("haven't saved anyone")
    expect(listReply([{ id: "1", title: "Mom", meta: { phone: "9876543210" } }])).not.toContain("9876543210")
  })
})
