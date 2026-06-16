export interface PackingBagMember {
  user_id: number
  username: string
  avatar?: string | null
}

export interface PackingBag {
  id: number
  trip_id: number
  name: string
  color: string
  weight_limit_grams: number | null
  user_id?: number | null
  assigned_username?: string | null
  members?: PackingBagMember[]
}

export interface TripMember {
  id: number
  username: string
  avatar?: string | null
  avatar_url?: string | null
}

export interface CategoryAssignee {
  user_id: number
  username: string
  avatar?: string | null
}

export const KAT_COLORS = [
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#22c55e',
  '#f97316',
  '#06b6d4',
  '#ef4444',
  '#eab308',
  '#8b5cf6',
  '#14b8a6',
]

export function katColor(kat: string, allCategories?: string[]): string {
  const idx = allCategories ? allCategories.indexOf(kat) : -1
  if (idx >= 0) return KAT_COLORS[idx % KAT_COLORS.length]
  let h = 0
  for (let i = 0; i < kat.length; i++) h = ((h << 5) - h + kat.charCodeAt(i)) | 0
  return KAT_COLORS[Math.abs(h) % KAT_COLORS.length]
}

export const PACKING_PLACEHOLDER_NAME = '...'
