import React, { useRef, useState } from 'react'
import {
  Trash2, Edit2, Archive, ArchiveRestore, Clock, MapPin, Copy,
  Users, CheckCircle2, Calendar,
} from 'lucide-react'
import { useCountUp } from '../hooks/useCountUp'

export interface DashboardTrip {
  id: number
  title: string
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  cover_image?: string | null
  is_archived?: boolean
  is_owner?: boolean
  owner_username?: string
  day_count?: number
  place_count?: number
  shared_count?: number
  [key: string]: string | number | boolean | null | undefined
}

export const MS_PER_DAY = 86400000

export const GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  'linear-gradient(135deg, #96fbc4 0%, #f9f586 100%)',
]

export function tripGradient(id: number): string { return GRADIENTS[id % GRADIENTS.length] }

export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00'); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / MS_PER_DAY)
}

export function getTripStatus(trip: DashboardTrip): string | null {
  const today = new Date().toISOString().split('T')[0]
  if (trip.start_date && trip.end_date && trip.start_date <= today && trip.end_date >= today) return 'ongoing'
  const until = daysUntil(trip.start_date)
  if (until === null) return null
  if (until === 0) return 'today'
  if (until === 1) return 'tomorrow'
  if (until > 1) return 'future'
  return 'past'
}

export function formatDate(dateStr: string | null | undefined, locale = 'en-US'): string | null {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function formatDateShort(dateStr: string | null | undefined, locale = 'en-US'): string | null {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function sortTrips(trips: DashboardTrip[]): DashboardTrip[] {
  const today = new Date().toISOString().split('T')[0]
  function rank(t: DashboardTrip) {
    if (t.start_date && t.end_date && t.start_date <= today && t.end_date >= today) return 0
    if (t.start_date && t.start_date >= today) return 1
    return 2
  }
  return [...trips].sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    const ad = a.start_date || '', bd = b.start_date || ''
    if (ra <= 1) return ad.localeCompare(bd)
    return bd.localeCompare(ad)
  })
}

export interface TripCardProps {
  trip: DashboardTrip
  onEdit?: (trip: DashboardTrip) => void
  onCopy?: (trip: DashboardTrip) => void
  onDelete?: (trip: DashboardTrip) => void
  onArchive?: (id: number) => void
  onClick: (trip: DashboardTrip) => void
  t: (key: string, params?: Record<string, string | number | null>) => string
  locale: string
  dark?: boolean
}

// ── Liquid Glass hover effect ────────────────────────────────────────────────
interface LiquidGlassProps {
  children: React.ReactNode
  dark: boolean
  style?: React.CSSProperties
  className?: string
  onClick?: () => void
}

export function LiquidGlass({ children, dark, style, className = '', onClick }: LiquidGlassProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const glareRef = useRef<HTMLDivElement>(null)
  const borderRef = useRef<HTMLDivElement>(null)

  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!ref.current || !glareRef.current || !borderRef.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    glareRef.current.style.background = `radial-gradient(circle 250px at ${x}px ${y}px, ${dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'} 0%, transparent 70%)`
    glareRef.current.style.opacity = '1'
    borderRef.current.style.opacity = '1'
    borderRef.current.style.maskImage = `radial-gradient(circle 120px at ${x}px ${y}px, black 0%, transparent 100%)`
    borderRef.current.style.WebkitMaskImage = `radial-gradient(circle 120px at ${x}px ${y}px, black 0%, transparent 100%)`
  }
  const onLeave = () => {
    if (glareRef.current) glareRef.current.style.opacity = '0'
    if (borderRef.current) borderRef.current.style.opacity = '0'
  }

  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} onClick={onClick} className={className}
      style={{ position: 'relative', overflow: 'hidden', ...style }}>
      <div ref={glareRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0, transition: 'opacity 0.3s', borderRadius: 'inherit', zIndex: 1 }} />
      <div ref={borderRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0, transition: 'opacity 0.3s', borderRadius: 'inherit', zIndex: 1,
        border: dark ? '1.5px solid rgba(255,255,255,0.4)' : '1.5px solid rgba(0,0,0,0.12)',
      }} />
      {children}
    </div>
  )
}

// ── Spotlight Stats ──────────────────────────────────────────────────────────
function SpotlightStats({ trip, totalDays, t }: { trip: DashboardTrip; totalDays: number; t: TripCardProps['t'] }): React.ReactElement {
  const days = useCountUp(trip.day_count || totalDays)
  const places = useCountUp(trip.place_count || 0)
  const buddies = useCountUp(trip.shared_count || 0)
  return (
    <div className="grid grid-cols-3 gap-2.5 p-3.5 bg-black/25 backdrop-blur-sm border border-white/10 rounded-2xl">
      <div className="text-center">
        <p className="text-[22px] font-extrabold tracking-[-0.02em] leading-none tabular-nums">{days}</p>
        <p className="text-[9px] uppercase tracking-[0.1em] opacity-70 font-semibold mt-1">{t('dashboard.mobile.days')}</p>
      </div>
      <div className="text-center">
        <p className="text-[22px] font-extrabold tracking-[-0.02em] leading-none tabular-nums">{places}</p>
        <p className="text-[9px] uppercase tracking-[0.1em] opacity-70 font-semibold mt-1">{t('dashboard.mobile.places')}</p>
      </div>
      <div className="text-center">
        <p className="text-[22px] font-extrabold tracking-[-0.02em] leading-none tabular-nums">{buddies}</p>
        <p className="text-[9px] uppercase tracking-[0.1em] opacity-70 font-semibold mt-1">{t('dashboard.mobile.buddies')}</p>
      </div>
    </div>
  )
}

// ── Spotlight Card ───────────────────────────────────────────────────────────
export function SpotlightCard({ trip, onEdit, onCopy, onDelete, onArchive, onClick, t, locale }: TripCardProps): React.ReactElement {
  const status = getTripStatus(trip)
  const isLive = status === 'ongoing'
  const today = new Date().toISOString().split('T')[0]
  const startDate = trip.start_date || today
  const endDate = trip.end_date || today
  const totalDays = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1)
  const currentDay = Math.min(totalDays, Math.ceil((new Date(today).getTime() - new Date(startDate).getTime()) / 86400000) + 1)
  const daysLeft = Math.max(0, totalDays - currentDay)
  const progress = Math.round((currentDay / totalDays) * 100)

  const badgeText = isLive ? t('dashboard.mobile.liveNow')
    : status === 'today' ? t('dashboard.mobile.startsToday')
    : status === 'tomorrow' ? t('dashboard.mobile.tomorrow')
    : status === 'future' ? t('dashboard.status.daysLeft', { count: daysUntil(trip.start_date) })
    : status === 'past' ? t('dashboard.mobile.completed')
    : null

  return (
    <div
      onClick={() => onClick(trip)}
      className="group relative rounded-3xl overflow-hidden cursor-pointer mb-8 transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[0_16px_60px_rgba(0,0,0,0.22)] active:scale-[0.995]"
      style={{ minHeight: 340, boxShadow: '0 8px 40px rgba(0,0,0,0.13)', isolation: 'isolate' }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-3xl" style={{
        background: trip.cover_image ? undefined : tripGradient(trip.id),
      }}>
        {trip.cover_image && (
          <>
            <img src={trip.cover_image} className="w-full h-full object-cover transition-transform duration-[1200ms] ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.06]" alt="" />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.6) 100%)' }} />
          </>
        )}
      </div>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, transparent 0%, transparent 40%, rgba(0,0,0,0.5) 100%)' }} />

      <div className="relative p-6 flex flex-col text-white z-[2]" style={{ minHeight: 340 }}>
        <div className="flex items-center justify-between mb-5">
          {badgeText ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/40 backdrop-blur-sm border border-white/15 rounded-full text-[10px] font-bold uppercase tracking-[0.1em]">
              {isLive ? (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)] animate-pulse" />
              ) : (
                <Clock size={10} />
              )}
              {badgeText}
            </span>
          ) : <span />}
          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            {onEdit && <button title={t('common.edit')} onClick={() => onEdit(trip)} className="w-[34px] h-[34px] rounded-[10px] bg-white/12 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition-colors"><Edit2 size={14} /></button>}
            {onCopy && <button title={t('dashboard.copyTrip')} onClick={() => onCopy(trip)} className="w-[34px] h-[34px] rounded-[10px] bg-white/12 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition-colors"><Copy size={14} /></button>}
            {onArchive && <button title={t('dashboard.archive')} onClick={() => onArchive(trip.id)} className="w-[34px] h-[34px] rounded-[10px] bg-white/12 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition-colors"><Archive size={14} /></button>}
            {onDelete && <button title={t('common.delete')} onClick={() => onDelete(trip)} className="w-[34px] h-[34px] rounded-[10px] bg-white/12 backdrop-blur-sm border border-white/15 flex items-center justify-center text-red-300 hover:bg-red-500/20 transition-colors"><Trash2 size={14} /></button>}
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-end mb-4">
          {!trip.is_owner && (
            <span className="inline-flex items-center gap-1 self-start px-2 py-0.5 bg-white/15 backdrop-blur-sm border border-white/15 rounded-full text-[9px] font-semibold uppercase tracking-[0.06em] mb-2">
              <Users size={9} /> {t('dashboard.sharedBy', { name: trip.owner_username })}
            </span>
          )}
          <h2 className="text-[32px] font-extrabold tracking-[-0.03em] leading-[0.95] mb-1.5">{trip.title}</h2>
          <p className="text-[12px] opacity-80 font-medium">
            {formatDateShort(trip.start_date, locale)} — {formatDateShort(trip.end_date, locale)}
            {isLive && <> · {t('journey.pdf.day')} {currentDay} / {totalDays}</>}
          </p>
        </div>

        {isLive && (
          <div className="mb-4">
            <div className="flex justify-between text-[11px] font-semibold mb-1.5">
              <span className="opacity-85">{t('dashboard.mobile.tripProgress')}</span>
              <span className="opacity-70">{t('dashboard.mobile.daysLeft', { count: daysLeft })}</span>
            </div>
            <div className="h-1.5 bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full relative"
                style={{
                  width: `${progress}%`,
                  animation: 'trek-progress-fill 900ms cubic-bezier(0.23,1,0.32,1) both',
                  ['--trek-progress-to' as string]: `${progress}%`,
                }}
              >
                <span className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_12px_rgba(255,255,255,0.9)]" />
              </div>
            </div>
          </div>
        )}

        <SpotlightStats trip={trip} totalDays={totalDays} t={t} />
      </div>
    </div>
  )
}

// ── Mobile Trip Card ─────────────────────────────────────────────────────────
export function MobileTripCard({ trip, onEdit, onCopy, onDelete, onArchive, onClick, t, locale }: Omit<TripCardProps, 'dark'>): React.ReactElement {
  const status = getTripStatus(trip)
  const until = daysUntil(trip.start_date)
  const duration = trip.start_date && trip.end_date
    ? Math.ceil((new Date(trip.end_date).getTime() - new Date(trip.start_date).getTime()) / 86400000) + 1
    : trip.day_count || null

  const badgeText = status === 'ongoing' ? t('dashboard.mobile.ongoing')
    : status === 'today' ? t('dashboard.mobile.startsToday')
    : status === 'tomorrow' ? t('dashboard.mobile.tomorrow')
    : until && until > 0 ? (until < 30 ? t('dashboard.mobile.inDays', { count: until }) : until < 365 ? t('dashboard.mobile.inMonths', { count: Math.round(until / 30) }) : `In ${Math.round(until / 365)}y`)
    : status === 'past' ? t('dashboard.mobile.completed')
    : null

  return (
    <div
      onClick={() => onClick?.(trip)}
      className="group rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden cursor-pointer transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 hover:shadow-md"
      style={{ background: 'var(--bg-card)', isolation: 'isolate' }}
    >
      <div className="relative h-[120px] overflow-hidden" style={{ background: trip.cover_image ? undefined : tripGradient(trip.id) }}>
        {trip.cover_image && (
          <img src={trip.cover_image} className="absolute inset-0 w-full h-full object-cover transition-transform duration-[800ms] ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.08]" alt="" />
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.5) 100%)' }} />

        <div className="absolute top-3 right-3 z-[2] flex gap-1">
          {onEdit && <button title={t('common.edit')} onClick={e => { e.stopPropagation(); onEdit(trip) }} className="w-[30px] h-[30px] rounded-[8px] bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white"><Edit2 size={12} /></button>}
          {onCopy && <button title={t('dashboard.copyTrip')} onClick={e => { e.stopPropagation(); onCopy(trip) }} className="w-[30px] h-[30px] rounded-[8px] bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white"><Copy size={12} /></button>}
          {onArchive && <button title={t('dashboard.archive')} onClick={e => { e.stopPropagation(); onArchive(trip.id) }} className="w-[30px] h-[30px] rounded-[8px] bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white"><Archive size={12} /></button>}
          {onDelete && <button title={t('common.delete')} onClick={e => { e.stopPropagation(); onDelete(trip) }} className="w-[30px] h-[30px] rounded-[8px] bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center text-red-300"><Trash2 size={12} /></button>}
        </div>

        {badgeText && (
          <div className="absolute top-2.5 left-2.5 z-[2]">
            <span className="inline-flex items-center gap-1 px-2 py-[3px] bg-black/40 backdrop-blur-sm border border-white/15 rounded-full text-white text-[9px] font-bold uppercase tracking-[0.06em]">
              {status === 'ongoing' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)] animate-pulse" />
              ) : status === 'past' ? (
                <CheckCircle2 size={10} />
              ) : (
                <Clock size={10} />
              )}
              {badgeText}
            </span>
          </div>
        )}

        <div className="absolute bottom-3.5 left-3.5 right-3.5 z-[2] text-white">
          <h3 className="text-[22px] font-extrabold tracking-[-0.02em] leading-none">{trip.title}</h3>
          {trip.description && (
            <p className="text-[11px] opacity-75 font-medium mt-1 truncate">{trip.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex gap-[18px]">
          {trip.start_date && (
            <div className="flex flex-col gap-px">
              <span className="text-[13px] font-bold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{formatDateShort(trip.start_date, locale)}</span>
              <span className="text-[9px] uppercase tracking-[0.06em] font-medium" style={{ color: 'var(--text-faint)' }}>{t('dashboard.mobile.starts')}</span>
            </div>
          )}
          {duration && (
            <div className="flex flex-col gap-px">
              <span className="text-[13px] font-bold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{duration} {duration === 1 ? t('dashboard.mobile.day') : t('dashboard.mobile.days')}</span>
              <span className="text-[9px] uppercase tracking-[0.06em] font-medium" style={{ color: 'var(--text-faint)' }}>{t('dashboard.mobile.duration')}</span>
            </div>
          )}
          <div className="flex flex-col gap-px">
            <span className="text-[13px] font-bold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{trip.place_count || 0}</span>
            <span className="text-[9px] uppercase tracking-[0.06em] font-medium" style={{ color: 'var(--text-faint)' }}>{t('dashboard.mobile.places')}</span>
          </div>
          {(trip.shared_count || 0) > 0 && (
            <div className="flex flex-col gap-px">
              <span className="text-[13px] font-bold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{trip.shared_count}</span>
              <span className="text-[9px] uppercase tracking-[0.06em] font-medium" style={{ color: 'var(--text-faint)' }}>{t('dashboard.mobile.buddies')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Regular Trip Card ────────────────────────────────────────────────────────
export function TripCard({ trip, onEdit, onCopy, onDelete, onArchive, onClick, t, locale }: Omit<TripCardProps, 'dark'>): React.ReactElement {
  const status = getTripStatus(trip)
  const until = daysUntil(trip.start_date)
  const duration = trip.start_date && trip.end_date
    ? Math.ceil((new Date(trip.end_date).getTime() - new Date(trip.start_date).getTime()) / 86400000) + 1
    : trip.day_count || null

  const badgeText = status === 'ongoing' ? t('dashboard.mobile.ongoing')
    : status === 'today' ? t('dashboard.mobile.startsToday')
    : status === 'tomorrow' ? t('dashboard.mobile.tomorrow')
    : until && until > 0 ? (until < 30 ? t('dashboard.mobile.inDays', { count: until }) : until < 365 ? t('dashboard.mobile.inMonths', { count: Math.round(until / 30) }) : `In ${Math.round(until / 365)}y`)
    : status === 'past' ? t('dashboard.mobile.completed')
    : null

  return (
    <div
      onClick={() => onClick(trip)}
      className="group rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden cursor-pointer transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 hover:shadow-lg hover:border-zinc-300 dark:hover:border-zinc-600"
      style={{ background: 'var(--bg-card)', isolation: 'isolate' }}
    >
      <div className="relative h-[140px] overflow-hidden" style={{ background: trip.cover_image ? undefined : tripGradient(trip.id) }}>
        {trip.cover_image && (
          <img src={trip.cover_image} className="absolute inset-0 w-full h-full object-cover transition-transform duration-[800ms] ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.08]" alt="" />
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.55) 100%)' }} />

        <div className="absolute top-3 right-3 z-[2] flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && <button title={t('common.edit')} onClick={e => { e.stopPropagation(); onEdit(trip) }} className="w-[30px] h-[30px] rounded-[8px] bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white hover:bg-black/50 transition-colors"><Edit2 size={12} /></button>}
          {onCopy && <button title={t('dashboard.copyTrip')} onClick={e => { e.stopPropagation(); onCopy(trip) }} className="w-[30px] h-[30px] rounded-[8px] bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white hover:bg-black/50 transition-colors"><Copy size={12} /></button>}
          {onArchive && <button title={t('dashboard.archive')} onClick={e => { e.stopPropagation(); onArchive(trip.id) }} className="w-[30px] h-[30px] rounded-[8px] bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white hover:bg-black/50 transition-colors"><Archive size={12} /></button>}
          {onDelete && <button title={t('common.delete')} onClick={e => { e.stopPropagation(); onDelete(trip) }} className="w-[30px] h-[30px] rounded-[8px] bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center text-red-300 hover:bg-red-500/30 transition-colors"><Trash2 size={12} /></button>}
        </div>

        {badgeText && (
          <div className="absolute top-2.5 left-2.5 z-[2]">
            <span className="inline-flex items-center gap-1 px-2 py-[3px] bg-black/40 backdrop-blur-sm border border-white/15 rounded-full text-white text-[9px] font-bold uppercase tracking-[0.06em]">
              {status === 'ongoing' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)] animate-pulse" />
              ) : status === 'past' ? (
                <CheckCircle2 size={10} />
              ) : (
                <Clock size={10} />
              )}
              {badgeText}
            </span>
          </div>
        )}

        {!trip.is_owner && (
          <div className="absolute top-3.5 right-3.5 z-[1] group-hover:opacity-0 transition-opacity">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-black/40 backdrop-blur-sm border border-white/15 rounded-full text-white text-[9px] font-semibold uppercase tracking-[0.06em]">
              <Users size={9} /> {t('dashboard.shared')}
            </span>
          </div>
        )}

        <div className="absolute bottom-3.5 left-3.5 right-3.5 z-[2] text-white">
          <h3 className="text-[20px] font-extrabold tracking-[-0.02em] leading-tight">{trip.title}</h3>
          {trip.description && (
            <p className="text-[11px] opacity-75 font-medium mt-1 truncate">{trip.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex gap-[18px]">
          {trip.start_date && (
            <div className="flex flex-col gap-px">
              <span className="text-[13px] font-bold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{formatDateShort(trip.start_date, locale)}</span>
              <span className="text-[9px] uppercase tracking-[0.06em] font-medium" style={{ color: 'var(--text-faint)' }}>{t('dashboard.mobile.starts')}</span>
            </div>
          )}
          {duration && (
            <div className="flex flex-col gap-px">
              <span className="text-[13px] font-bold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{duration} {duration === 1 ? t('dashboard.mobile.day') : t('dashboard.mobile.days')}</span>
              <span className="text-[9px] uppercase tracking-[0.06em] font-medium" style={{ color: 'var(--text-faint)' }}>{t('dashboard.mobile.duration')}</span>
            </div>
          )}
          <div className="flex flex-col gap-px">
            <span className="text-[13px] font-bold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{trip.place_count || 0}</span>
            <span className="text-[9px] uppercase tracking-[0.06em] font-medium" style={{ color: 'var(--text-faint)' }}>{t('dashboard.mobile.places')}</span>
          </div>
          {(trip.shared_count || 0) > 0 && (
            <div className="flex flex-col gap-px">
              <span className="text-[13px] font-bold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{trip.shared_count}</span>
              <span className="text-[9px] uppercase tracking-[0.06em] font-medium" style={{ color: 'var(--text-faint)' }}>{t('dashboard.mobile.buddies')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── List View Item ───────────────────────────────────────────────────────────
export function TripListItem({ trip, onEdit, onCopy, onDelete, onArchive, onClick, t, locale }: Omit<TripCardProps, 'dark'>): React.ReactElement {
  const status = getTripStatus(trip)
  const [hovered, setHovered] = useState(false)

  const coverBg = trip.cover_image
    ? `url(${trip.cover_image}) center/cover no-repeat`
    : tripGradient(trip.id)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onClick(trip)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px',
        background: hovered ? 'var(--bg-tertiary)' : 'var(--bg-card)', borderRadius: 14,
        border: `1px solid ${hovered ? 'var(--text-faint)' : 'var(--border-primary)'}`,
        cursor: 'pointer', transition: 'all 0.15s',
        boxShadow: hovered ? '0 4px 16px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <div style={{
        width: 52, height: 52, borderRadius: 12, flexShrink: 0,
        background: coverBg, position: 'relative', overflow: 'hidden',
      }}>
        {status === 'ongoing' && (
          <span style={{
            position: 'absolute', top: 4, left: 4,
            width: 7, height: 7, borderRadius: '50%', background: '#ef4444',
            animation: 'blink 1s ease-in-out infinite',
          }} />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {trip.title}
          </span>
          {!trip.is_owner && (
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: 99, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {t('dashboard.shared')}
            </span>
          )}
          {status && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 99,
              background: status === 'ongoing' ? 'rgba(239,68,68,0.1)' : 'var(--bg-tertiary)',
              color: status === 'ongoing' ? '#ef4444' : 'var(--text-muted)',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              {status === 'ongoing' ? t('dashboard.status.ongoing')
                : status === 'today' ? t('dashboard.status.today')
                : status === 'tomorrow' ? t('dashboard.status.tomorrow')
                : status === 'future' ? t('dashboard.status.daysLeft', { count: daysUntil(trip.start_date) })
                : t('dashboard.mobile.completed')}
            </span>
          )}
        </div>
        {trip.description && (
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {trip.description}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        {trip.start_date && (
          <div className="hidden sm:flex" style={{ alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
            <Calendar size={11} />
            {formatDateShort(trip.start_date, locale)}
            {trip.end_date && <> — {formatDateShort(trip.end_date, locale)}</>}
          </div>
        )}
        <div className="hidden md:flex" style={{ alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
          <Clock size={11} /> {trip.day_count || 0}
        </div>
        <div className="hidden md:flex" style={{ alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
          <MapPin size={11} /> {trip.place_count || 0}
        </div>
        <div className="hidden md:flex" style={{ alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
          <Users size={11} /> {trip.shared_count || 0}
        </div>
      </div>

      {(onEdit || onCopy || onArchive || onDelete) && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {onEdit && <CardAction onClick={() => onEdit(trip)} icon={<Edit2 size={12} />} label="" />}
          {onCopy && <CardAction onClick={() => onCopy(trip)} icon={<Copy size={12} />} label="" />}
          {onArchive && <CardAction onClick={() => onArchive(trip.id)} icon={<Archive size={12} />} label="" />}
          {onDelete && <CardAction onClick={() => onDelete(trip)} icon={<Trash2 size={12} />} label="" danger />}
        </div>
      )}
    </div>
  )
}

// ── Archived Row ─────────────────────────────────────────────────────────────
interface ArchivedRowProps {
  trip: DashboardTrip
  onEdit?: (trip: DashboardTrip) => void
  onCopy?: (trip: DashboardTrip) => void
  onUnarchive?: (id: number) => void
  onDelete?: (trip: DashboardTrip) => void
  onClick: (trip: DashboardTrip) => void
  t: (key: string, params?: Record<string, string | number | null>) => string
  locale: string
}

export function ArchivedRow({ trip, onEdit, onCopy, onUnarchive, onDelete, onClick, t, locale }: ArchivedRowProps): React.ReactElement {
  return (
    <div onClick={() => onClick(trip)} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
      borderRadius: 12, border: '1px solid var(--border-faint)', background: 'var(--bg-card)', cursor: 'pointer',
      transition: 'border-color 0.12s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-primary)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-faint)'}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        background: trip.cover_image ? `url(${trip.cover_image}) center/cover no-repeat` : tripGradient(trip.id),
        opacity: 0.7,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.title}</span>
          {!trip.is_owner && <span style={{ fontSize: 10, color: 'var(--text-faint)', background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: 99, flexShrink: 0 }}>{t('dashboard.shared')}</span>}
        </div>
        {trip.start_date && (
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
            {formatDateShort(trip.start_date, locale)}{trip.end_date ? ` — ${formatDateShort(trip.end_date, locale)}` : ''}
          </div>
        )}
      </div>
      {(onEdit || onCopy || onUnarchive || onDelete) && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {onCopy && <button onClick={() => onCopy(trip)} title={t('dashboard.copyTrip')} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-faint)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.color = 'var(--text-muted)' }}>
            <Copy size={12} />
          </button>}
          {onUnarchive && <button onClick={() => onUnarchive(trip.id)} title={t('dashboard.restore')} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-faint)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.color = 'var(--text-muted)' }}>
            <ArchiveRestore size={12} /> {t('dashboard.restore')}
          </button>}
          {onDelete && <button onClick={() => onDelete(trip)} title={t('common.delete')} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-faint)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#fecaca'; e.currentTarget.style.color = '#ef4444' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.color = 'var(--text-faint)' }}>
            <Trash2 size={12} />
          </button>}
        </div>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────
export function CardAction({ onClick, icon, label, danger }: { onClick: () => void; icon: React.ReactNode; label: string; danger?: boolean }): React.ReactElement {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 8,
      border: 'none', background: 'none', cursor: 'pointer', fontSize: 11,
      color: '#9ca3af', fontFamily: 'inherit',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? '#fef2f2' : '#f3f4f6'; e.currentTarget.style.color = danger ? '#ef4444' : '#374151' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#9ca3af' }}>
      {icon}{label}
    </button>
  )
}

export function SkeletonCard(): React.ReactElement {
  return (
    <div
      className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
      style={{ background: 'var(--bg-card)' }}
    >
      <div className="trek-skeleton" style={{ height: 120, borderRadius: 0 }} />
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="trek-skeleton" style={{ height: 14, width: '70%' }} />
        <div className="trek-skeleton" style={{ height: 11, width: '50%' }} />
      </div>
    </div>
  )
}
