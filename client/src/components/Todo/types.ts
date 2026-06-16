export interface TodoMember {
  id: number
  username: string
  avatar: string | null
}

export const TODO_KAT_COLORS = [
  '#3b82f6', '#a855f7', '#ec4899', '#22c55e', '#f97316',
  '#06b6d4', '#ef4444', '#eab308', '#8b5cf6', '#14b8a6',
]

export const TODO_PRIO_CONFIG: Record<number, { label: string; color: string }> = {
  1: { label: 'P1', color: '#ef4444' },
  2: { label: 'P2', color: '#f59e0b' },
  3: { label: 'P3', color: '#3b82f6' },
}

export function todoKatColor(kat: string, allCategories: string[]): string {
  const idx = allCategories.indexOf(kat)
  if (idx >= 0) return TODO_KAT_COLORS[idx % TODO_KAT_COLORS.length]
  let h = 0
  for (let i = 0; i < kat.length; i++) h = ((h << 5) - h + kat.charCodeAt(i)) | 0
  return TODO_KAT_COLORS[Math.abs(h) % TODO_KAT_COLORS.length]
}

export type TodoCategoryAssignee = { user_id: number; username: string; avatar?: string | null }
