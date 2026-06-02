import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useTranslation, SUPPORTED_LANGUAGES } from '../i18n'
import { useSettingsStore } from '../store/settingsStore'
import { getLocaleForLanguage } from '../i18n'
import { shareApi } from '../api/client'
import { getCategoryIcon } from '../components/shared/categoryIcons'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Clock, MapPin, FileText, Train, Plane, Bus, Car, Ship, Ticket, Hotel, Map, Luggage, Wallet, MessageCircle } from 'lucide-react'
import { isDayInAccommodationRange } from '../utils/dayOrder'
import { getTransportForDay, getMergedItems } from '../utils/dayMerge'
import PublicThemeToggle from '../components/shared/PublicThemeToggle'

const TRANSPORT_ICONS = { flight: Plane, train: Train, bus: Bus, car: Car, cruise: Ship }

function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  )
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return isDark
}

function createMarkerIcon(place: any) {
  const cat = place.category
  const color = cat?.color || '#6366f1'
  const CatIcon = getCategoryIcon(cat?.icon)
  const iconSvg = renderToStaticMarkup(createElement(CatIcon, { size: 14, strokeWidth: 2, color: 'white' }))
  return L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid white;">${iconSvg}</div>`,
  })
}

function FitBoundsToPlaces({ places }: { places: any[] }) {
  const map = useMap()
  useEffect(() => {
    if (places.length === 0) return
    const bounds = L.latLngBounds(places.map(p => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
  }, [places, map])
  return null
}

export default function SharedTripPage() {
  const { token } = useParams<{ token: string }>()
  const { t, locale } = useTranslation()
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState(false)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState('plan')
  const [showLangPicker, setShowLangPicker] = useState(false)
  const isDark = useDarkMode()

  useEffect(() => {
    if (!token) return
    shareApi.getSharedTrip(token).then(setData).catch(() => setError(true))
  }, [token])

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-tertiary)' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{t('shared.expired')}</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>{t('shared.expiredHint')}</p>
      </div>
    </div>
  )

  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-tertiary)' }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--border-primary)', borderTopColor: 'var(--text-primary)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  const { trip, days, assignments, dayNotes, places, reservations, accommodations, packing, budget, categories, permissions, collab } = data
  const sortedDays = [...(days || [])].sort((a: any, b: any) => a.day_number - b.day_number)

  const mapPlaces = selectedDay
    ? (assignments[String(selectedDay)] || []).map((a: any) => a.place).filter((p: any) => p?.lat && p?.lng)
    : (places || []).filter((p: any) => p?.lat && p?.lng)

  const center = mapPlaces.length > 0 ? [mapPlaces[0].lat, mapPlaces[0].lng] : [48.85, 2.35]
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-secondary)', fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #000 0%, #0f172a 50%, #1e293b 100%)', color: 'white', padding: '32px 20px 28px', textAlign: 'center', position: 'relative' }}>
        {/* Cover image background */}
        {trip.cover_image && (
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${trip.cover_image.startsWith('http') ? trip.cover_image : trip.cover_image.startsWith('/') ? trip.cover_image : '/uploads/' + trip.cover_image})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.15 }} />
        )}
        {/* Background decoration */}
        <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />
        <div style={{ position: 'absolute', bottom: -40, left: -40, width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,0.02)' }} />

        {/* Logo */}
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', marginBottom: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
          <img src="/icons/icon-white.svg" alt="TREK" width="26" height="26" />
        </div>

        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', opacity: 0.35, marginBottom: 12 }}>Travel Resource &amp; Exploration Kit</div>

        <h1 style={{ margin: '0 0 4px', fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>{trip.title}</h1>

        {trip.description && (
          <div style={{ fontSize: 13, opacity: 0.5, maxWidth: 400, margin: '0 auto', lineHeight: 1.5 }}>{trip.description}</div>
        )}

        {(trip.start_date || trip.end_date) && (
          <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.8 }}>
              {[trip.start_date, trip.end_date].filter(Boolean).map((d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })).join(' — ')}
            </span>
            {days?.length > 0 && <span style={{ fontSize: 11, opacity: 0.4 }}>·</span>}
            {days?.length > 0 && <span style={{ fontSize: 11, opacity: 0.5 }}>{days.length} {t('shared.days')}</span>}
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 9, fontWeight: 500, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.25 }}>{t('shared.readOnly')}</div>

        {/* Controls - top right: theme toggle + language picker */}
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
          <PublicThemeToggle />
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowLangPicker(v => !v)} style={{
              padding: '5px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)',
              color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {SUPPORTED_LANGUAGES.find(l => l.value === (locale?.split('-')[0] || 'en'))?.label || 'Language'}
            </button>
            {showLangPicker && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: 'var(--bg-card)', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', padding: 4, zIndex: 50, minWidth: 150 }}>
                {SUPPORTED_LANGUAGES.map(lang => (
                  <button key={lang.value} onClick={() => {
                    useSettingsStore.setState(s => ({ settings: { ...s.settings, language: lang.value } }))
                    setShowLangPicker(false)
                  }}
                    style={{ display: 'block', width: '100%', padding: '6px 12px', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)', borderRadius: 6, fontFamily: 'inherit' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >{lang.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', padding: '2px 0' }}>
          {[
            { id: 'plan', label: t('shared.tabPlan'), Icon: Map },
            ...(permissions?.share_bookings ? [{ id: 'bookings', label: t('shared.tabBookings'), Icon: Ticket }] : []),
            ...(permissions?.share_packing ? [{ id: 'packing', label: t('shared.tabPacking'), Icon: Luggage }] : []),
            ...(permissions?.share_budget ? [{ id: 'budget', label: t('shared.tabBudget'), Icon: Wallet }] : []),
            ...(permissions?.share_collab ? [{ id: 'collab', label: t('shared.tabChat'), Icon: MessageCircle }] : []),
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '8px 18px', borderRadius: 12, border: '1.5px solid', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6,
              background: activeTab === tab.id ? 'var(--accent)' : 'var(--bg-card)',
              borderColor: activeTab === tab.id ? 'var(--accent)' : 'var(--border-primary)',
              color: activeTab === tab.id ? 'var(--accent-text)' : 'var(--text-muted)',
              boxShadow: activeTab === tab.id ? '0 2px 8px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
            }}><tab.Icon size={13} /><span className="hidden sm:inline">{tab.label}</span></button>
          ))}
        </div>

        {/* Map */}
        {activeTab === 'plan' && (<>
        <div style={{ borderRadius: 16, overflow: 'hidden', height: 300, marginBottom: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <MapContainer center={center as [number, number]} zoom={11} zoomControl={false} style={{ width: '100%', height: '100%' }}>
            <TileLayer key={tileUrl} url={tileUrl} referrerPolicy="strict-origin-when-cross-origin" />
            <FitBoundsToPlaces places={mapPlaces} />
            {mapPlaces.map((p: any) => (
              <Marker key={p.id} position={[p.lat, p.lng]} icon={createMarkerIcon(p)}>
                <Tooltip>{p.name}</Tooltip>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Day Plan */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sortedDays.map((day: any, di: number) => {
            const da = assignments[String(day.id)] || []
            const notes = (dayNotes[String(day.id)] || [])
            const dayAssignmentIds: number[] = da.map((a: any) => a.id)
            const dayTransport = getTransportForDay({ reservations: reservations || [], dayId: day.id, dayAssignmentIds, days: sortedDays })
            const dayAccs = (accommodations || []).filter((a: any) => isDayInAccommodationRange(day, a.start_day_id, a.end_day_id, sortedDays))

            const merged = getMergedItems({
              dayAssignments: da,
              dayNotes: notes,
              dayTransports: dayTransport,
              dayId: day.id,
            })

            return (
              <div key={day.id} style={{ background: 'var(--bg-card)', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-primary)' }}>
                <div onClick={() => setSelectedDay(selectedDay === day.id ? null : day.id)}
                  style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: selectedDay === day.id ? 'var(--accent)' : 'var(--bg-tertiary)', color: selectedDay === day.id ? 'var(--accent-text)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{di + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{day.title || `Day ${day.day_number}`}</div>
                    {day.date && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{new Date(day.date + 'T00:00:00Z').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>}
                  </div>
                  {dayAccs.map((acc: any) => (
                    <span key={acc.id} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-tertiary)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Hotel size={8} /> {acc.place_name}
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{da.length} {t('shared.places')}</span>
                </div>

                {selectedDay === day.id && merged.length > 0 && (
                  <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {merged.map((item: any) => {
                      if (item.type === 'transport') {
                        const r = item.data
                        const TIcon = TRANSPORT_ICONS[r.type] || Ticket
                        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {})
                        const time = r.reservation_time?.includes('T') ? r.reservation_time.split('T')[1]?.substring(0, 5) : ''
                        let sub = ''
                        if (r.type === 'flight') sub = [meta.airline, meta.flight_number, meta.departure_airport && meta.arrival_airport ? `${meta.departure_airport} → ${meta.arrival_airport}` : ''].filter(Boolean).join(' · ')
                        else if (r.type === 'train') sub = [meta.train_number, meta.platform ? `Gl. ${meta.platform}` : ''].filter(Boolean).join(' · ')
                        return (
                          <div key={`t-${r.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
                            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(59,130,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <TIcon size={12} color="#3b82f6" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{r.title}{time ? ` · ${time}` : ''}</div>
                              {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sub}</div>}
                            </div>
                          </div>
                        )
                      }
                      if (item.type === 'note') {
                        return (
                          <div key={`n-${item.data.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border-secondary)' }}>
                            <FileText size={12} color="var(--text-faint)" />
                            <div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.data.text}</div>
                              {item.data.time && <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{item.data.time}</div>}
                            </div>
                          </div>
                        )
                      }
                      const place = item.data.place
                      if (!place) return null
                      const cat = categories?.find((c: any) => c.id === place.category_id)
                      return (
                        <div key={`p-${item.data.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6 }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: cat?.color || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {place.image_url ? <img src={place.image_url} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} /> : <MapPin size={13} color="white" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)' }}>{place.name}</div>
                            {(place.address || place.description) && <div style={{ fontSize: 10, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.address || place.description}</div>}
                          </div>
                          {place.place_time && <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}><Clock size={9} />{place.place_time}{place.end_time ? ` – ${place.end_time}` : ''}</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        </>)}

        {/* Bookings */}
        {activeTab === 'bookings' && (reservations || []).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(reservations || []).map((r: any) => {
              const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {})
              const TIcon = TRANSPORT_ICONS[r.type] || Ticket
              const time = r.reservation_time?.includes('T') ? r.reservation_time.split('T')[1]?.substring(0, 5) : ''
              const date = r.reservation_time ? new Date((r.reservation_time.includes('T') ? r.reservation_time.split('T')[0] : r.reservation_time) + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''
              return (
                <div key={r.id} style={{ background: 'var(--bg-card)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <TIcon size={15} color="var(--text-muted)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                      {date && <span>{date}</span>}
                      {time && <span>{time}</span>}
                      {r.location && <span>{r.location}</span>}
                      {meta.airline && <span>{meta.airline} {meta.flight_number || ''}</span>}
                      {meta.train_number && <span>{meta.train_number}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 600, background: r.status === 'confirmed' ? 'rgba(22,163,74,0.1)' : 'rgba(217,119,6,0.1)', color: r.status === 'confirmed' ? '#16a34a' : '#d97706' }}>
                    {r.status === 'confirmed' ? t('shared.confirmed') : t('shared.pending')}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Packing */}
        {activeTab === 'packing' && (packing || []).length > 0 && (
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
            {Object.entries((packing || []).reduce((g: any, i: any) => { const c = i.category || t('shared.other'); (g[c] = g[c] || []).push(i); return g }, {})).map(([cat, items]: [string, any]) => (
              <div key={cat}>
                <div style={{ padding: '8px 16px', background: 'var(--bg-secondary)', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-secondary)' }}>{cat}</div>
                {items.map((item: any) => (
                  <div key={item.id} style={{ padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--bg-secondary)' }}>
                    <span style={{ fontSize: 13, color: item.checked ? 'var(--text-faint)' : 'var(--text-primary)', textDecoration: item.checked ? 'line-through' : 'none' }}>{item.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Budget */}
        {activeTab === 'budget' && (budget || []).length > 0 && (() => {
          const grouped = (budget || []).reduce((g: any, i: any) => { const c = i.category || t('shared.other'); (g[c] = g[c] || []).push(i); return g }, {})
          const total = (budget || []).reduce((s: number, i: any) => s + (parseFloat(i.total_price) || 0), 0)
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Total card */}
              <div style={{ background: 'linear-gradient(135deg, #000 0%, #1a1a2e 100%)', borderRadius: 14, padding: '20px 24px', color: 'white' }}>
                <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.5 }}>{t('shared.totalBudget')}</div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{total.toLocaleString(locale, { minimumFractionDigits: 2 })} {trip.currency || 'NOK'}</div>
              </div>
              {/* By category */}
              {Object.entries(grouped).map(([cat, items]: [string, any]) => (
                <div key={cat} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 16px', background: 'var(--bg-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-secondary)' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{cat}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{items.reduce((s: number, i: any) => s + (parseFloat(i.total_price) || 0), 0).toLocaleString(locale, { minimumFractionDigits: 2 })} {trip.currency || ''}</span>
                  </div>
                  {items.map((item: any) => (
                    <div key={item.id} style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-secondary)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{item.name}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.total_price ? Number(item.total_price).toLocaleString(locale, { minimumFractionDigits: 2 }) : '—'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        })()}

        {/* Collab Chat */}
        {activeTab === 'collab' && (collab || []).length > 0 && (
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageCircle size={14} color="var(--text-muted)" />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('shared.tabChat')} · {(collab || []).length} {t('shared.messages')}</span>
            </div>
            <div style={{ maxHeight: 500, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(collab || []).map((msg: any, i: number) => {
                const prevMsg = i > 0 ? collab[i - 1] : null
                const showDate = !prevMsg || new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString()
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div style={{ textAlign: 'center', margin: '8px 0', fontSize: 10, fontWeight: 600, color: 'var(--text-faint)' }}>
                        {new Date(msg.created_at).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--border-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0, overflow: 'hidden' }}>
                        {msg.avatar ? <img src={`/uploads/avatars/${msg.avatar}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (msg.username || '?')[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{msg.username}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{new Date(msg.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '40px 0 20px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 20, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <img src="/icons/icon.svg" alt="TREK" width="18" height="18" style={{ borderRadius: 4 }} />
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('shared.sharedVia')} <strong style={{ color: 'var(--text-muted)' }}>TREK</strong></span>
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--border-primary)' }}>Made with <span style={{ color: '#ef4444' }}>&hearts;</span> by Maurice · <a href="https://github.com/mauriceboe/TREK" style={{ color: 'var(--text-faint)', textDecoration: 'none' }}>GitHub</a></div>
        </div>
      </div>
    </div>
  )
}
