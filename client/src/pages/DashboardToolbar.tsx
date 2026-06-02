import React from 'react'
import { Plus, List, LayoutGrid, Settings } from 'lucide-react'

interface DashboardToolbarProps {
  activeTab: 'trips' | 'discover'
  onTabChange: (tab: 'trips' | 'discover') => void
  viewMode: 'grid' | 'list'
  onViewToggle: () => void
  showWidgetSettings: boolean | 'mobile' | 'mobile-currency' | 'mobile-timezone'
  onWidgetSettingsToggle: () => void
  tripCount: number
  archivedCount: number
  isLoading: boolean
  canCreateTrip: boolean
  onNewTrip: () => void
  t: (key: string, params?: Record<string, string | number | null>) => string
}

export default function DashboardToolbar({
  activeTab, onTabChange,
  viewMode, onViewToggle,
  showWidgetSettings, onWidgetSettingsToggle,
  tripCount, archivedCount, isLoading,
  canCreateTrip, onNewTrip,
  t,
}: DashboardToolbarProps): React.ReactElement {
  const widgetOpen = !!showWidgetSettings

  const tabBtn = (tab: 'trips' | 'discover', label: string, testId: string) => (
    <button
      data-testid={testId}
      onClick={() => onTabChange(tab)}
      style={{
        padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
        background: activeTab === tab ? 'var(--bg-card)' : 'transparent',
        color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
        boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      {label}
    </button>
  )

  const subtitle = isLoading
    ? t('common.loading')
    : tripCount > 0
      ? `${t(tripCount !== 1 ? 'dashboard.subtitle.activeMany' : 'dashboard.subtitle.activeOne', { count: tripCount })}${archivedCount > 0 ? t('dashboard.subtitle.archivedSuffix', { count: archivedCount }) : ''}`
      : t('dashboard.subtitle.empty')

  return (
    <div className="hidden md:block" style={{ marginBottom: 20 }}>
      <div style={{
        background: 'var(--bg-tertiary)', borderRadius: 18,
        border: '1px solid var(--border-primary)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        padding: '14px 16px 14px 22px',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {tabBtn('trips', t('dashboard.title'), 'tab-my-trips')}
          {tabBtn('discover', 'Discover', 'tab-discover')}
        </div>

        <div style={{ width: 1, height: 22, background: 'var(--border-faint)', flexShrink: 0 }} />

        {activeTab === 'trips' && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{subtitle}</span>
        )}

        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
          {activeTab === 'trips' && (
            <>
              <button
                onClick={onViewToggle}
                title={viewMode === 'grid' ? t('dashboard.listView') : t('dashboard.gridView')}
                style={{
                  appearance: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: '7px 11px', borderRadius: 99,
                  background: 'transparent', color: 'var(--text-muted)',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                {viewMode === 'grid' ? <List size={15} /> : <LayoutGrid size={15} />}
              </button>
              <button
                onClick={onWidgetSettingsToggle}
                title={t('dashboard.widgets') || 'Widgets'}
                style={{
                  appearance: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: '7px 11px', borderRadius: 99,
                  background: widgetOpen ? 'var(--bg-card)' : 'transparent',
                  color: widgetOpen ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: widgetOpen ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { if (!widgetOpen) { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)' } }}
                onMouseLeave={e => { if (!widgetOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' } }}
              >
                <Settings size={15} />
              </button>
              {canCreateTrip && (
                <button
                  onClick={onNewTrip}
                  style={{
                    appearance: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500,
                    background: 'var(--accent)', color: 'var(--accent-text)', flexShrink: 0,
                    marginLeft: 2,
                  }}
                  className="hover:opacity-[0.88]"
                >
                  <Plus size={14} strokeWidth={2.5} /> {t('dashboard.newTrip')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
