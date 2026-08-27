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

  const [
    areas,
    pendingTasks,
    overdueTasks,
    activeGoals,
    habits,
    recentBehavior,
    identity,
    user,
    goalLinkedTasks,
    pendingCaptures,
    lastReview,
    activeProjects,
    continueResources,
    vaultItems,
    insightNotes,
    advanceLinks,
    userSettings,
  ] = await Promise.all([
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
          targetMinutes: true,
        },
      }),

      // Tasks overdue (dueDate in the past, not completed)
      prisma.task.findMany({
        where: {
          userId,
          status: { in: ["TODO", "IN_PROGRESS"] },
          dueDate: { lt: new Date() },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          areaId: true,
          priority: true,
          targetMinutes: true,
        },
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
          targetMinutes: true,
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

      // Identity — the user's full self-model, so suggestions can be
      // specific to who they are, not just what they've logged.
      prisma.identity.findUnique({
        where: { userId },
        select: {
          purpose: true,
          thisYearGoal: true,
          values: true,
          bigPicture: true,
          lifeVision: true,
          personality: true,
          strengths: true,
          weaknesses: true,
        },
      }),

      // User timezone — so the coach computes "today"/streaks/scores locally.
      prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),

      // Tasks linked to any goal (all statuses) — powers live goal confidence
      // inside the coach so a stalling active goal can be surfaced, not just one
      // with a near deadline.
      prisma.task.findMany({
        where: { userId, goalId: { not: null } },
        select: { goalId: true, status: true, completedAt: true },
      }),

      // Count of unsorted brain-dumps — so the coach can nudge inbox processing.
      prisma.capture.count({ where: { userId, status: "PENDING" } }),

      // Most recent review — to detect "it's been a while since you reflected".
      prisma.review.findFirst({
        where: { userId },
        orderBy: { periodEnd: "desc" },
        select: { periodEnd: true, reviewType: true },
      }),

      // Active projects with their tasks — to flag a stalling project.
      prisma.project.findMany({
        where: { userId, status: "ACTIVE" },
        select: {
          id: true,
          title: true,
          areaId: true,
          tasks: { select: { status: true, completedAt: true, dueDate: true } },
        },
      }),

      // In-progress learning resources — "keep going on what you started".
      prisma.resource.findMany({
        where: { userId, status: "IN_PROGRESS" },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, title: true, topic: { select: { areaId: true } } },
      }),

      // A few vault items — motivation/recovery the coach can resurface.
      prisma.vaultItem.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, title: true, vaultType: true, usedCount: true, helpfulCount: true },
      }),

      // Recent insight notes — to nudge revisiting an idea worth developing.
      prisma.note.findMany({
        where: { userId, noteType: "INSIGHT" },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, title: true },
      }),

      // ADVANCES links from tasks to goals/resources — lets the coach prefer a
      // pending task that actually moves an active goal or an in-progress
      // resource forward, over an equally-ranked orphan task (phase 4).
      prisma.entityLink.findMany({
        where: {
          userId,
          fromType: "TASK",
          role: "ADVANCES",
          toType: { in: ["GOAL", "RESOURCE"] },
        },
        select: { fromId: true, toType: true, toId: true },
      }),

      // Which optional modules this user has actually opted into — so the
      // coach can tell "disabled on purpose" apart from "just empty" and
      // never nag about a module the user deliberately turned off.
      prisma.userSettings.findUnique({
        where: { userId },
        select: { enabledModules: true },
      }),
    ])

  return {
    areas,
    pendingTasks,
    overdueTasks,
    activeGoals,
    habits,
    recentBehavior,
    identity,
    timezone: user?.timezone ?? "UTC",
    goalLinkedTasks,
    pendingCaptures,
    lastReview,
    activeProjects,
    continueResources,
    vaultItems,
    insightNotes,
    advanceLinks,
    // Empty/missing = every optional module is on (matches the settings
    // module's own "empty means all enabled" rule).
    enabledModules: userSettings?.enabledModules ?? [],
  }
}
