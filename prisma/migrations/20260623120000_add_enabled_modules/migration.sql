-- Add per-user module selection. Defaults to an empty array, which the app
-- treats as "all optional modules enabled", so existing rows are unaffected.
ALTER TABLE "UserSettings"
  ADD COLUMN "enabledModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
