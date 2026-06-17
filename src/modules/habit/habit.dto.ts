// Response DTOs for Habit and its daily logs.
export interface HabitDto {
  id: string
  areaId: string
  title: string
  description: string | null
  habitType: string
  targetCount: number | null
  targetMinutes: number | null
  frequency: string
  weeklyTarget: number | null
  specificDays: string[]
  reminderTime: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface HabitLogDto {
  id: string
  habitId: string
  date: Date
  completed: boolean
  count: number
  minutes: number
  notes: string | null
  createdAt: Date
}

// Habit enriched with derived stats — returned by GET /habits so the
// client doesn't need an N+1 call to /habits/:id/logs just to show
// streaks and today's status (B4).
export interface HabitWithStatsDto extends HabitDto {
  currentStreak: number
  longestStreak: number
  todayDone: boolean
  todayLog: HabitLogDto | null
  history: boolean[]
}
