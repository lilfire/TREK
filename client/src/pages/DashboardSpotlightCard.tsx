import React, { useRef } from 'react'
import { Clock, Edit2, Copy, Archive, Trash2, Users } from 'lucide-react'
import { useCountUp } from '../hooks/useCountUp'
import {
  type TripCardProps, type DashboardTrip,
  tripGradient, getTripStatus, daysUntil, formatDateShort,
} from './DashboardTripCardTypes'

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
    borderRef.current.style.webkitMaskImage = `radial-gradient(circle 120px at ${x}px ${y}px, black 0%, transparent 100%)`
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
