import prisma from "./src/lib/prisma.js"
for (let i = 0; i < 40; i++) {
  try {
    const r = await prisma.user.deleteMany({ where: { email: { startsWith: "live-smoke-" } } })
    const left = await prisma.user.count({ where: { email: { endsWith: "@test.local" } } })
    console.log("DONE deleted " + r.count + "; @test.local left: " + left)
    break
  } catch {
    await new Promise((r) => setTimeout(r, 30000))
  }
}
process.exit(0)
