import React, { useState } from 'react'
import { Clock, MapPin, Edit2, Copy, Archive, Trash2, Calendar, Users } from 'lucide-react'
import {
  type TripCardProps,
  tripGradient, getTripStatus, daysUntil, formatDateShort,
} from './DashboardTripCardTypes'

// ── Card Action (shared helper, used only in list/archived views) ─────────────
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

// ── List View Item ────────────────────────────────────────────────────────────
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
