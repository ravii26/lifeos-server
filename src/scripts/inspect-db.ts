import prisma from "../lib/prisma.js"

async function main() {
  const users = await prisma.user.findMany()
  console.log("Users:", users.map(u => ({ id: u.id, email: u.email })))

  for (const u of users) {
    console.log(`\n=== User: ${u.email} (${u.id}) ===`)
    const tasks = await prisma.task.findMany({ where: { userId: u.id } })
    console.log("Tasks:", tasks.map(t => ({ id: t.id, title: t.title, status: t.status })))

    const goals = await prisma.goal.findMany({ where: { userId: u.id } })
    console.log("Goals:", goals.map(g => ({ id: g.id, title: g.title, status: g.status })))

    const captures = await prisma.capture.findMany({ where: { userId: u.id } })
    console.log("Captures:", captures.map(c => ({ id: c.id, rawText: c.rawText, status: c.status })))
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
