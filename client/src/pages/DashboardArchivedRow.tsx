import React from 'react'
import { ArchiveRestore, Copy, Trash2 } from 'lucide-react'
import { type DashboardTrip, tripGradient, formatDateShort } from './DashboardTripCardTypes'

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

export function ArchivedRow({ trip, onCopy, onUnarchive, onDelete, onClick, t, locale }: ArchivedRowProps): React.ReactElement {
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
      {(onCopy || onUnarchive || onDelete) && (
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
