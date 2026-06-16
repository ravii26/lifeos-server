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
