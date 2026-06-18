import prisma from "../../lib/prisma.js"

// Pull everything the Decision Engine needs in parallel — one query per
// data type, no N+1. The service blends this into the Gemini context object.

export const findDecisionContext = async (userId: string) => {
  const since7d = new Date()
  since7d.setUTCDate(since7d.getUTCDate() - 7)

  const since28d = new Date()
  since28d.setUTCDate(since28d.getUTCDate() - 28)

  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  const [areas, pendingTasks, overdueTasks, activeGoals, habits, recentBehavior, identity] =
    await Promise.all([
      // Areas with scoring data
      prisma.area.findMany({
        where: { userId, isActive: true },
        orderBy: { order: "asc" },
      }),

      // Incomplete tasks — top 20 by priority + due date
      prisma.task.findMany({
        where: { userId, status: { in: ["TODO", "IN_PROGRESS"] } },
        orderBy: [
          {
            priority: "desc",
          },
          { dueDate: "asc" },
          { createdAt: "asc" },
        ],
        take: 20,
        select: {
          id: true,
          title: true,
          priority: true,
          dueDate: true,
          areaId: true,
          status: true,
          isRecurring: true,
        },
      }),

      // Tasks overdue (dueDate in the past, not completed)
      prisma.task.findMany({
        where: {
          userId,
          status: { in: ["TODO", "IN_PROGRESS"] },
          dueDate: { lt: new Date() },
        },
        select: { id: true, title: true, dueDate: true, areaId: true, priority: true },
      }),

      // Active goals
      prisma.goal.findMany({
        where: { userId, status: "ACTIVE" },
        select: { id: true, title: true, areaId: true, priority: true, deadline: true },
      }),

      // Active habits with last 28 days of logs (for streak/today status)
      prisma.habit.findMany({
        where: { userId, isActive: true },
        select: {
          id: true,
          title: true,
          areaId: true,
          frequency: true,
          logs: {
            where: { date: { gte: since28d } },
            orderBy: { date: "desc" },
            select: { date: true, completed: true },
          },
        },
      }),

      // Last 7 days of behavior — what has the user actually been doing?
      prisma.behaviorLog.findMany({
        where: { userId, occurredAt: { gte: since7d } },
        orderBy: { occurredAt: "desc" },
        take: 100,
        select: { eventType: true, occurredAt: true },
      }),

      // Identity — values, purpose, goals for richer suggestions
      prisma.identity.findUnique({
        where: { userId },
        select: { purpose: true, thisYearGoal: true, values: true },
      }),
    ])

  return { areas, pendingTasks, overdueTasks, activeGoals, habits, recentBehavior, identity }
}
