import prisma from "../../lib/prisma.js"

interface CreateUserData {
  email: string
  passwordHash: string
  name: string
  timezone: string
}

export const findUserByEmail = (email: string) => {
  return prisma.user.findUnique({ where: { email } })
}

export const findUserById = (id: string) => {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, timezone: true },
  })
}

// The user's IANA timezone — used everywhere "today"/streaks/scores are
// computed so day boundaries follow the user, not server UTC. Defaults to UTC
// if the user somehow has none.
export const getUserTimezone = async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  })
  return user?.timezone ?? "UTC"
}

export const createUser = (data: CreateUserData) => {
  return prisma.user.create({
    data,
    select: { id: true, email: true, name: true, timezone: true },
  })
}

// Lifetime profile stats (B10) — gathered in parallel counts/aggregates.
export const getUserStats = async (userId: string) => {
  const [user, tasksDone, habitsLogged, focus] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    prisma.task.count({ where: { userId, status: "COMPLETED" } }),
    prisma.habitLog.count({ where: { userId } }),
    prisma.focusSession.aggregate({ where: { userId }, _sum: { durationMinutes: true } }),
  ])
  return {
    joinedAt: user?.createdAt ?? null,
    tasksDone,
    habitsLogged,
    focusHours: Math.round(((focus._sum.durationMinutes ?? 0) / 60) * 10) / 10,
  }
}
