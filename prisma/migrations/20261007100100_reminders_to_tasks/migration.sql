-- Reminders become to-dos with a time. Copy every reminder that hasn't been
-- cancelled, keeping its id so phones that already scheduled it don't double up.
INSERT INTO "Task" ("id", "userId", "title", "status", "priority", "taskType", "remindAt", "source", "isRecurring", "completedCount", "createdAt", "updatedAt", "completedAt")
SELECT r."id", r."userId", r."text",
       CASE WHEN r."status" = 'DONE' THEN 'COMPLETED'::"TaskStatus" ELSE 'TODO'::"TaskStatus" END,
       'MEDIUM'::"Priority", 'BOOLEAN'::"TaskType", r."remindAt", 'REMINDER'::"TaskSource", false, 0,
       r."createdAt", r."updatedAt",
       CASE WHEN r."status" = 'DONE' THEN r."updatedAt" ELSE NULL END
FROM "Reminder" r
WHERE r."status" <> 'CANCELLED'
ON CONFLICT ("id") DO NOTHING;
