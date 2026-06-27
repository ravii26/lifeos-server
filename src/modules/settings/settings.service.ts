import { findSettings, upsertSettings } from "./settings.repository.js"
import type { UpdateSettingsDto } from "./settings.schema.js"

const DEFAULTS = {
  vibe: "calm",
  accent: "#6366f1",
  font: "inter",
  startTab: "today",
  enabledModules: [] as string[], // empty == all optional modules on
}

export const getSettingsService = async (userId: string) => {
  return (await findSettings(userId)) ?? { userId, ...DEFAULTS }
}

export const updateSettingsService = (userId: string, input: UpdateSettingsDto) => {
  return upsertSettings(userId, input)
}
