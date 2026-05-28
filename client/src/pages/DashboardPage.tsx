import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useSettingsStore } from '../store/settingsStore'
import { useTranslation } from '../i18n'
import Navbar from '../components/Layout/Navbar'
import DemoBanner from '../components/Layout/DemoBanner'
import CurrencyWidget from '../components/Dashboard/CurrencyWidget'
import TimezoneWidget from '../components/Dashboard/TimezoneWidget'
import TripFormModal from '../components/Trips/TripFormModal'
import ConfirmDialog from '../components/shared/ConfirmDialog'
import CopyTripDialog from '../components/shared/CopyTripDialog'
import DashboardDiscoverTab from './DashboardDiscoverTab'
import { useDashboardData } from '../hooks/useDashboardData'
import {
  LiquidGlass, SpotlightCard, MobileTripCard, TripCard, TripListItem,
  ArchivedRow, SkeletonCard, getTripStatus, type DashboardTrip,
} from './DashboardTripCards'
import {
  Plus, Map, ChevronDown, ChevronUp,
  Archive, Clock, Settings, X, ArrowRightLeft,
  LayoutGrid, List, Bell,
} from 'lucide-react'
import { useCanDo } from '../store/permissionsStore'

const font: React.CSSProperties = { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }

export default function DashboardPage(): React.ReactElement {
  const [editingTrip, setEditingTrip] = useState<DashboardTrip | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [showWidgetSettings, setShowWidgetSettings] = useState<boolean | 'mobile' | 'mobile-currency' | 'mobile-timezone'>(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => (localStorage.getItem('trek_dashboard_view') as 'grid' | 'list') || 'grid')
  const [activeTab, setActiveTab] = useState<'trips' | 'discover'>('trips')

  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { t, locale } = useTranslation()
  const { demoMode, user } = useAuthStore()
  const { settings, updateSetting } = useSettingsStore()
  const can = useCanDo()
  const dm = settings.dark_mode
  const dark = dm === true || dm === 'dark' || (dm === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const showCurrency = settings.dashboard_currency !== 'off'
  const showTimezone = settings.dashboard_timezone !== 'off'
  const showSidebar = showCurrency || showTimezone

  const {
    trips, archivedTrips, isLoading,
    handleCreate, handleUpdate,
    handleDelete, confirmDelete, deleteTrip, setDeleteTrip,
    handleArchive, handleUnarchive,
    handleCoverUpdate,
    handleCopy, confirmCopy, copyTrip, setCopyTrip,
  } = useDashboardData()

  const toggleViewMode = () => {
    setViewMode(prev => {
      const next = prev === 'grid' ? 'list' : 'grid'
      localStorage.setItem('trek_dashboard_view', next)
      return next
    })
  }

  useEffect(() => {
    if (showWidgetSettings === 'mobile' || showWidgetSettings === 'mobile-currency' || showWidgetSettings === 'mobile-timezone') {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [showWidgetSettings])

  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setShowForm(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams])

  const today = new Date().toISOString().split('T')[0]
  const spotlight = trips.find(t => t.start_date && t.end_date && t.start_date <= today && t.end_date >= today)
    || trips.find(t => t.start_date && t.start_date >= today)
    || trips[0]
    || null
  const rest = spotlight ? trips.filter(t => t.id !== spotlight.id) : trips

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', ...font }}>
      <Navbar />
      {demoMode && <DemoBanner />}
      <div style={{ flex: 1, overflow: 'auto', overscrollBehavior: 'contain', marginTop: 'var(--nav-h)' }}>
        <div style={{ maxWidth: 1300, margin: '0 auto', paddingTop: 32, paddingLeft: 20, paddingRight: 20, paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 0px))' }}>

          {/* Mobile greeting header */}
          <div className="md:hidden flex items-center justify-between mb-5">
            <div>
              <p className="text-[12px] text-zinc-500 font-medium">{new Date().getHours() < 12 ? t('dashboard.greeting.morning') : new Date().getHours() < 18 ? t('dashboard.greeting.afternoon') : t('dashboard.greeting.evening')}</p>
              <p className="text-[22px] font-extrabold tracking-[-0.025em] leading-tight" style={{ color: 'var(--text-primary)' }}>{user?.username || t('nav.profile')}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/notifications')}
                className="w-10 h-10 rounded-xl flex items-center justify-center relative"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}
              >
                <Bell size={18} />
              </button>
              <button
                onClick={() => navigate('/settings')}
                className="w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-bold text-white overflow-hidden"
                style={{ background: user?.avatar_url ? undefined : 'linear-gradient(135deg, #6366F1, #8B5CF6)' }}
              >
                {user?.avatar_url
                  ? <img src={user.avatar_url} className="w-full h-full object-cover" alt="" />
                  : (user?.username || '?')[0].toUpperCase()
                }
              </button>
            </div>
          </div>

          {/* Mobile: Hero Trip (spotlight — ongoing or next upcoming) */}
          {!isLoading && spotlight && activeTab === 'trips' && (
            <div className="md:hidden mb-5">
              <SpotlightCard
                trip={spotlight}
                t={t} locale={locale}
                onEdit={(can('trip_edit', spotlight) || can('trip_cover_upload', spotlight)) ? tr => { setEditingTrip(tr); setShowForm(true) } : undefined}
                onCopy={can('trip_create') ? handleCopy : undefined}
                onDelete={can('trip_delete', spotlight) ? handleDelete : undefined}
                onArchive={can('trip_archive', spotlight) ? handleArchive : undefined}
                onClick={tr => navigate(`/trips/${tr.id}`)}
              />
            </div>
          )}

          {/* Mobile: Quick Actions */}
          <div className="md:hidden grid grid-cols-3 gap-2 mb-6">
            {can('trip_create') && (
              <button
                onClick={() => { setEditingTrip(null); setShowForm(true) }}
                className="flex flex-col items-center gap-2 py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700"
                style={{ background: 'var(--bg-card)' }}
              >
                <div className="w-9 h-9 rounded-[11px] flex items-center justify-center" style={{ background: '#FEF3C7', color: '#B45309' }}>
                  <Plus size={16} />
                </div>
                <span className="text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dashboard.mobile.newTrip')}</span>
              </button>
            )}
            <button
              onClick={() => setShowWidgetSettings('mobile-currency')}
              className="flex flex-col items-center gap-2 py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700"
              style={{ background: 'var(--bg-card)' }}
            >
              <div className="w-9 h-9 rounded-[11px] flex items-center justify-center" style={{ background: '#DBEAFE', color: '#1E40AF' }}>
                <ArrowRightLeft size={16} />
              </div>
              <span className="text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dashboard.mobile.currency')}</span>
            </button>
            <button
              onClick={() => setShowWidgetSettings('mobile-timezone')}
              className="flex flex-col items-center gap-2 py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700"
              style={{ background: 'var(--bg-card)' }}
            >
              <div className="w-9 h-9 rounded-[11px] flex items-center justify-center" style={{ background: '#DCFCE7', color: '#15803D' }}>
                <Clock size={16} />
              </div>
              <span className="text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dashboard.mobile.timezone')}</span>
            </button>
          </div>

          {/* Desktop header — unified toolbar */}
          <div className="hidden md:block" style={{ marginBottom: 20 }}>
            <div style={{
              background: 'var(--bg-tertiary)', borderRadius: 18,
              border: '1px solid var(--border-primary)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
              padding: '14px 16px 14px 22px',
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
            }}>
              {/* Tab navigation */}
              <div style={{ display: 'flex', gap: 2 }}>
                <button
                  data-testid="tab-my-trips"
                  onClick={() => setActiveTab('trips')}
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                    background: activeTab === 'trips' ? 'var(--bg-card)' : 'transparent',
                    color: activeTab === 'trips' ? 'var(--text-primary)' : 'var(--text-muted)',
                    boxShadow: activeTab === 'trips' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  {t('dashboard.title')}
                </button>
                <button
                  data-testid="tab-discover"
                  onClick={() => setActiveTab('discover')}
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                    background: activeTab === 'discover' ? 'var(--bg-card)' : 'transparent',
                    color: activeTab === 'discover' ? 'var(--text-primary)' : 'var(--text-muted)',
                    boxShadow: activeTab === 'discover' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  Discover
                </button>
              </div>

              <div style={{ width: 1, height: 22, background: 'var(--border-faint)', flexShrink: 0 }} />

              {activeTab === 'trips' && (
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {isLoading ? t('common.loading')
                    : trips.length > 0 ? `${t(trips.length !== 1 ? 'dashboard.subtitle.activeMany' : 'dashboard.subtitle.activeOne', { count: trips.length })}${archivedTrips.length > 0 ? t('dashboard.subtitle.archivedSuffix', { count: archivedTrips.length }) : ''}`
                    : t('dashboard.subtitle.empty')}
                </span>
              )}

              <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
                {activeTab === 'trips' && (
                  <>
                    <button
                      onClick={toggleViewMode}
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
                      onClick={() => setShowWidgetSettings(s => s ? false : true)}
                      title={t('dashboard.widgets') || 'Widgets'}
                      style={{
                        appearance: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        padding: '7px 11px', borderRadius: 99,
                        background: showWidgetSettings ? 'var(--bg-card)' : 'transparent',
                        color: showWidgetSettings ? 'var(--text-primary)' : 'var(--text-muted)',
                        boxShadow: showWidgetSettings ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => { if (!showWidgetSettings) { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)' } }}
                      onMouseLeave={e => { if (!showWidgetSettings) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' } }}
                    >
                      <Settings size={15} />
                    </button>
                    {can('trip_create') && (
                      <button
                        onClick={() => { setEditingTrip(null); setShowForm(true) }}
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

          {/* Widget settings dropdown */}
          {showWidgetSettings && activeTab === 'trips' && (
            <div className="rounded-xl border p-3 mb-4 flex items-center gap-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Widgets:</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <button onClick={() => updateSetting('dashboard_currency', showCurrency ? 'off' : 'on')}
                  className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                  style={{ background: showCurrency ? 'var(--text-primary)' : 'var(--border-primary)' }}>
                  <span className="absolute left-0.5 h-4 w-4 rounded-full transition-transform duration-200"
                    style={{ background: 'var(--bg-card)', transform: showCurrency ? 'translateX(16px)' : 'translateX(0)' }} />
                </button>
                <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{t('dashboard.currency')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <button onClick={() => updateSetting('dashboard_timezone', showTimezone ? 'off' : 'on')}
                  className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                  style={{ background: showTimezone ? 'var(--text-primary)' : 'var(--border-primary)' }}>
                  <span className="absolute left-0.5 h-4 w-4 rounded-full transition-transform duration-200"
                    style={{ background: 'var(--bg-card)', transform: showTimezone ? 'translateX(16px)' : 'translateX(0)' }} />
                </button>
                <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{t('dashboard.timezone')}</span>
              </label>
            </div>
          )}

          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            {/* Main content */}
            <div style={{ flex: 1, minWidth: 0 }}>

              {/* Discover tab */}
              {activeTab === 'discover' && (
                <DashboardDiscoverTab userTrips={trips} />
              )}

              {activeTab === 'trips' && (
                <>
                  {/* Loading skeletons */}
                  {isLoading && (
                    <>
                      <div className="trek-skeleton" style={{ height: 260, borderRadius: 24, marginBottom: 32 }} />
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                        {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
                      </div>
                    </>
                  )}

                  {/* Empty state */}
                  {!isLoading && trips.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '80px 20px' }}>
                      <div style={{ width: 80, height: 80, background: '#f3f4f6', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                        <Map size={36} style={{ color: '#d1d5db' }} />
                      </div>
                      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{t('dashboard.emptyTitle')}</h3>
                      <p style={{ margin: '0 0 24px', fontSize: 14, color: '#9ca3af', maxWidth: 340, marginLeft: 'auto', marginRight: 'auto' }}>
                        {t('dashboard.emptyText')}
                      </p>
                      {can('trip_create') && <button
                        onClick={() => { setEditingTrip(null); setShowForm(true) }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 22px', background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        <Plus size={16} /> {t('dashboard.emptyButton')}
                      </button>}
                    </div>
                  )}

                  {/* Spotlight (grid mode, desktop only) */}
                  {!isLoading && spotlight && viewMode === 'grid' && (
                    <div className="hidden md:block"><SpotlightCard
                      trip={spotlight}
                      t={t} locale={locale} dark={dark}
                      onEdit={(can('trip_edit', spotlight) || can('trip_cover_upload', spotlight)) ? tr => { setEditingTrip(tr); setShowForm(true) } : undefined}
                      onCopy={can('trip_create') ? handleCopy : undefined}
                      onDelete={can('trip_delete', spotlight) ? handleDelete : undefined}
                      onArchive={can('trip_archive', spotlight) ? handleArchive : undefined}
                      onClick={tr => navigate(`/trips/${tr.id}`)}
                    /></div>
                  )}

                  {/* Mobile trip cards */}
                  {!isLoading && rest.length > 0 && (
                    <div className="md:hidden flex flex-col gap-3 mb-10">
                      <div className="flex items-baseline justify-between px-1 pb-1">
                        <span className="text-[11px] font-bold tracking-[0.12em] uppercase" style={{ color: 'var(--text-faint)' }}>
                          {rest.some(t => getTripStatus(t) === 'future' || getTripStatus(t) === 'tomorrow') ? t('dashboard.mobile.upcomingTrips') : t('dashboard.mobile.yourTrips')}
                        </span>
                        <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{rest.length} {t('dashboard.mobile.trips')}</span>
                      </div>
                      {rest.map(trip => (
                        <MobileTripCard
                          key={trip.id}
                          trip={trip}
                          t={t} locale={locale}
                          onEdit={(can('trip_edit', trip) || can('trip_cover_upload', trip)) ? tr => { setEditingTrip(tr); setShowForm(true) } : undefined}
                          onCopy={can('trip_create') ? handleCopy : undefined}
                          onDelete={can('trip_delete', trip) ? handleDelete : undefined}
                          onArchive={can('trip_archive', trip) ? handleArchive : undefined}
                          onClick={tr => navigate(`/trips/${tr.id}`)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Desktop grid or list */}
                  {!isLoading && (viewMode === 'grid' ? rest : trips).length > 0 && (
                    viewMode === 'grid' ? (
                      <div className="trip-grid hidden md:grid trek-stagger" style={{ gap: 16, marginBottom: 40 }}>
                        {rest.map(trip => (
                          <TripCard
                            key={trip.id}
                            trip={trip}
                            t={t} locale={locale}
                            onEdit={(can('trip_edit', trip) || can('trip_cover_upload', trip)) ? tr => { setEditingTrip(tr); setShowForm(true) } : undefined}
                            onCopy={can('trip_create') ? handleCopy : undefined}
                            onDelete={can('trip_delete', trip) ? handleDelete : undefined}
                            onArchive={can('trip_archive', trip) ? handleArchive : undefined}
                            onClick={tr => navigate(`/trips/${tr.id}`)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="hidden md:flex trek-stagger" style={{ flexDirection: 'column', gap: 8, marginBottom: 40 }}>
                        {trips.map(trip => (
                          <TripListItem
                            key={trip.id}
                            trip={trip}
                            t={t} locale={locale}
                            onEdit={(can('trip_edit', trip) || can('trip_cover_upload', trip)) ? tr => { setEditingTrip(tr); setShowForm(true) } : undefined}
                            onCopy={can('trip_create') ? handleCopy : undefined}
                            onDelete={can('trip_delete', trip) ? handleDelete : undefined}
                            onArchive={can('trip_archive', trip) ? handleArchive : undefined}
                            onClick={tr => navigate(`/trips/${tr.id}`)}
                          />
                        ))}
                      </div>
                    )
                  )}

                  {/* Archived section */}
                  {!isLoading && archivedTrips.length > 0 && (
                    <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 24 }}>
                      <button
                        onClick={() => setShowArchived(v => !v)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: showArchived ? 16 : 0, fontFamily: 'inherit' }}
                      >
                        <Archive size={15} style={{ color: '#9ca3af' }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>
                          {t('dashboard.archived')} ({archivedTrips.length})
                        </span>
                        {showArchived ? <ChevronUp size={14} style={{ color: '#9ca3af' }} /> : <ChevronDown size={14} style={{ color: '#9ca3af' }} />}
                      </button>
                      {showArchived && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {archivedTrips.map(trip => (
                            <ArchivedRow
                              key={trip.id}
                              trip={trip}
                              t={t} locale={locale}
                              onEdit={(can('trip_edit', trip) || can('trip_cover_upload', trip)) ? tr => { setEditingTrip(tr); setShowForm(true) } : undefined}
                              onCopy={can('trip_create') ? handleCopy : undefined}
                              onUnarchive={can('trip_archive', trip) ? handleUnarchive : undefined}
                              onDelete={can('trip_delete', trip) ? handleDelete : undefined}
                              onClick={tr => navigate(`/trips/${tr.id}`)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Widgets sidebar */}
            {showSidebar && activeTab === 'trips' && (
              <div className="hidden lg:flex flex-col gap-4" style={{ position: 'sticky', top: 80, flexShrink: 0, width: 280 }}>
                {showCurrency && <LiquidGlass dark={dark} style={{ borderRadius: 16 }}><CurrencyWidget /></LiquidGlass>}
                {showTimezone && <LiquidGlass dark={dark} style={{ borderRadius: 16 }}><TimezoneWidget /></LiquidGlass>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile widgets bottom sheet */}
      {(showWidgetSettings === 'mobile' || showWidgetSettings === 'mobile-currency' || showWidgetSettings === 'mobile-timezone') && (
        <div className="lg:hidden fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.3)', touchAction: 'none' }} onClick={() => setShowWidgetSettings(false)}>
          <div className="absolute left-0 right-0 flex flex-col overflow-hidden"
            style={{ bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))', maxHeight: '70vh', background: 'var(--bg-card)', borderRadius: '20px 20px 0 0', overscrollBehavior: 'contain', animation: 'slideUp 0.25s ease-out' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border-primary)' }} />
            </div>
            <div className="flex items-center justify-between px-5 pb-3">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {showWidgetSettings === 'mobile-currency' ? t('dashboard.mobile.currencyConverter') : showWidgetSettings === 'mobile-timezone' ? t('dashboard.mobile.timezone') : t('common.settings')}
              </span>
              <button onClick={() => setShowWidgetSettings(false)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-secondary)' }}>
                <X size={14} style={{ color: 'var(--text-primary)' }} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4" style={{ borderTop: '1px solid var(--border-secondary)' }}>
              {(showWidgetSettings === 'mobile' || showWidgetSettings === 'mobile-currency') && <CurrencyWidget />}
              {(showWidgetSettings === 'mobile' || showWidgetSettings === 'mobile-timezone') && <TimezoneWidget />}
            </div>
          </div>
        </div>
      )}

      <TripFormModal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingTrip(null) }}
        onSave={editingTrip ? (data) => handleUpdate(editingTrip.id, data) : handleCreate}
        trip={editingTrip}
        onCoverUpdate={handleCoverUpdate}
      />

      <ConfirmDialog
        isOpen={!!deleteTrip}
        onClose={() => setDeleteTrip(null)}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        message={t('dashboard.confirm.delete', { title: deleteTrip?.title || '' })}
      />

      <CopyTripDialog
        isOpen={!!copyTrip}
        tripTitle={copyTrip?.title || ''}
        onClose={() => setCopyTrip(null)}
        onConfirm={confirmCopy}
      />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1 }
          50% { opacity: 0.5 }
        }
        @keyframes blink {
          0%, 100% { opacity: 1 }
          50% { opacity: 0 }
        }
        .trip-grid { grid-template-columns: repeat(3, 1fr); }
        @media(max-width: 1024px) { .trip-grid { grid-template-columns: repeat(2, 1fr); } }
        @media(max-width: 640px) { .trip-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
