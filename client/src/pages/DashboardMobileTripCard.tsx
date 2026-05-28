import React from 'react'
import { Clock, Edit2, Copy, Archive, Trash2, CheckCircle2 } from 'lucide-react'
import {
  type TripCardProps,
  tripGradient, getTripStatus, daysUntil, formatDateShort,
} from './DashboardTripCardTypes'

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
