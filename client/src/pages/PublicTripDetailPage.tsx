import { useState, useEffect, createElement } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, Clock, FileText, ChevronRight, Paperclip } from 'lucide-react'
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { publicTripsApi } from '../api/client'
import { useTranslation, SUPPORTED_LANGUAGES } from '../i18n'
import { useSettingsStore } from '../store/settingsStore'
import { getCategoryIcon } from '../components/shared/categoryIcons'
import { renderToStaticMarkup } from 'react-dom/server'
import RsvpForm from '../components/Trips/RsvpForm'
import PublicActivityModal from '../components/PublicActivityModal'
import UnplannedActivitiesSection from '../components/UnplannedActivitiesSection'
import PublicThemeToggle from '../components/shared/PublicThemeToggle'

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

function FitBoundsToPlaces({ places }: { places: any[] }) {
  const map = useMap()
  useEffect(() => {
    if (places.length === 0) return
    const bounds = L.latLngBounds(places.map(p => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
  }, [places, map])
  return null
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}min`
  if (mins === 0) return `${hours}hr`
  return `${hours}hr ${mins}min`
}

export function truncateText(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text
  const slice = text.slice(0, maxLen)
  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + '…'
}

export default function PublicTripDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale } = useTranslation()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set())
  const [showLangPicker, setShowLangPicker] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState<any>(null)
  const isDark = useDarkMode()

  useEffect(() => {
    if (!id) return
    setLoading(true)
    publicTripsApi
      .get(id)
      .then(d => {
        setData(d)
        // expand all days by default
        if (d?.days) {
          setExpandedDays(new Set((d.days as any[]).map((day: any) => day.id)))
        }
      })
      .catch((err: any) => {
        if (err?.response?.status === 404) setNotFound(true)
        else setNotFound(true)
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div data-testid="not-found" className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="text-center px-4">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">Trip not found</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">This trip is not publicly available.</p>
        </div>
      </div>
    )
  }

  const { trip, days, assignments, dayNotes, budgetItems, places } = data
  const sortedDays: any[] = [...(days || [])].sort((a: any, b: any) => a.day_number - b.day_number)

  const assignedPlaceIds = new Set(
    Object.values(assignments).flat().map((a: any) => a.place.id)
  )
  const unplannedPlaces = (places || []).filter((p: any) => !assignedPlaceIds.has(p.id))
    .sort((a: any, b: any) => {
      const catA = (a.category_name || '').toLowerCase()
      const catB = (b.category_name || '').toLowerCase()
      if (!a.category_name && b.category_name) return 1
      if (a.category_name && !b.category_name) return -1
      if (catA !== catB) return catA.localeCompare(catB)
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
    })

  const mapPlaces = (places || [])
    .filter((p: any) => p?.lat && p?.lng)
    .map((p: any) => ({ ...p, category: { name: p.category_name, color: p.category_color, icon: p.category_icon } }))

  function toggleDay(dayId: number) {
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (next.has(dayId)) next.delete(dayId)
      else next.add(dayId)
      return next
    })
  }

  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

  function formatDate(d: string) {
    return new Date(d + 'T00:00:00Z').toLocaleDateString(locale, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    })
  }

  const isMember = data?.trip?.user_is_member === true
  const rsvpDeadlineVal: string | null = data?.trip?.rsvp_deadline ?? null
  const todayIso = new Date().toISOString().split('T')[0]
  const rsvpClosed = rsvpDeadlineVal != null && todayIso > rsvpDeadlineVal
  const rsvpHeadingKey = isMember
    ? 'publicTrip.rsvp.headingMember'
    : rsvpClosed
      ? 'publicTrip.rsvp.headingClosed'
      : 'publicTrip.rsvp.heading'
  const rsvpSubheadingKey = isMember
    ? 'publicTrip.rsvp.subheadingMember'
    : rsvpClosed
      ? 'publicTrip.rsvp.subheadingClosed'
      : 'publicTrip.rsvp.subheading'

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Hero header */}
      <div
        className="relative text-white text-center"
        style={{ background: 'linear-gradient(135deg, #000 0%, #0f172a 50%, #1e293b 100%)', padding: '32px 20px 28px' }}
      >
        {trip.cover_image && (
          <>
            <div
              data-testid="cover-image"
              style={{
                position: 'absolute', inset: 0,
                backgroundImage: `url(${trip.cover_image.startsWith('http') || trip.cover_image.startsWith('/') ? trip.cover_image : '/uploads/' + trip.cover_image})`,
                backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.5,
              }}
            />
            <div
              style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.65) 100%)',
              }}
            />
          </>
        )}
        <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />
        <div style={{ position: 'absolute', bottom: -40, left: -40, width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,0.02)' }} />

        {/* Controls - top right: theme toggle + language picker */}
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
          <PublicThemeToggle />
          <div style={{ position: 'relative' }}>
            <button
              data-testid="lang-picker-btn"
              onClick={() => setShowLangPicker(v => !v)}
              style={{
                padding: '5px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)',
                color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {SUPPORTED_LANGUAGES.find(l => l.value === (locale?.split('-')[0] || 'en'))?.label || 'Language'}
            </button>
            {showLangPicker && (
              <div
                data-testid="lang-picker-dropdown"
                style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 6, background: 'var(--bg-card)',
                  borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', padding: 4, zIndex: 50, minWidth: 150,
                }}
              >
                {SUPPORTED_LANGUAGES.map(lang => (
                  <button
                    key={lang.value}
                    onClick={() => {
                      useSettingsStore.setState(s => ({ settings: { ...s.settings, language: lang.value } }))
                      setShowLangPicker(false)
                    }}
                    style={{
                      display: 'block', width: '100%', padding: '6px 12px', border: 'none', background: 'none',
                      textAlign: 'left', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)', borderRadius: 6, fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="relative">
          <h1 data-testid="trip-title" style={{ margin: '0 0 4px', fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>
            {trip.title}
          </h1>

          {trip.description && (
            <p style={{ fontSize: 13, opacity: 0.5, maxWidth: 400, margin: '0 auto', lineHeight: 1.5 }}>
              {trip.description}
            </p>
          )}

          {(trip.start_date || trip.end_date) && (
            <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.8 }}>
                {[trip.start_date, trip.end_date]
                  .filter(Boolean)
                  .map((d: string) => formatDate(d))
                  .join(' — ')}
              </span>
              {sortedDays.length > 0 && (
                <>
                  <span style={{ fontSize: 11, opacity: 0.4 }}>·</span>
                  <span style={{ fontSize: 11, opacity: 0.5 }}>{sortedDays.length} days</span>
                </>
              )}
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 9, fontWeight: 500, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.25 }}>
            Read-only view
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[900px] mx-auto px-4 py-6">
        {/* Map */}
        {mapPlaces.length > 0 && (
          <div data-testid="trip-map" style={{ borderRadius: 16, overflow: 'hidden', height: 300, marginBottom: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
            <MapContainer
              center={[mapPlaces[0].lat, mapPlaces[0].lng]}
              zoom={11}
              zoomControl={false}
              style={{ width: '100%', height: '100%' }}
            >
              <TileLayer key={tileUrl} url={tileUrl} referrerPolicy="strict-origin-when-cross-origin" />
              <FitBoundsToPlaces places={mapPlaces} />
              {mapPlaces.map((p: any) => (
                <Marker key={p.id} position={[p.lat, p.lng]} icon={createMarkerIcon(p)}>
                  <Tooltip>{p.name}</Tooltip>
                </Marker>
              ))}
            </MapContainer>
          </div>
        )}

        {/* Itinerary */}
        <section data-testid="itinerary" aria-label="Trip itinerary" className="flex flex-col gap-3 mb-10">
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Itinerary</h2>

          {sortedDays.length === 0 && (
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">No days planned yet.</p>
          )}

          {sortedDays.map((day: any, di: number) => {
            const dayAssignments: any[] = (assignments[String(day.id)] || [])
            const notes: any[] = (dayNotes[String(day.id)] || [])
            const isExpanded = expandedDays.has(day.id)

            return (
              <div
                key={day.id}
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden"
              >
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  onClick={() => toggleDay(day.id)}
                  aria-expanded={isExpanded}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors"
                    style={{ background: isExpanded ? 'var(--accent)' : 'var(--bg-tertiary)', color: isExpanded ? 'var(--accent-text)' : 'var(--text-muted)' }}
                  >
                    {di + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-white">
                      {day.title || `Day ${day.day_number}`}
                    </div>
                    {day.date && (
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {new Date(day.date + 'T00:00:00Z').toLocaleDateString(locale, {
                          weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
                        })}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-zinc-400 flex-shrink-0">
                    {dayAssignments.length} {dayAssignments.length === 1 ? 'place' : 'places'}
                  </span>
                </button>

                {isExpanded && (dayAssignments.length > 0 || notes.length > 0) && (
                  <div className="px-4 pb-3 flex flex-col gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-2">
                    {notes.map((note: any) => (
                      <div key={`n-${note.id}`} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                        <FileText size={13} className="flex-shrink-0 mt-0.5 text-zinc-400" />
                        <span>{note.text}</span>
                        {note.time && (
                          <span className="ml-auto text-xs text-zinc-400 flex items-center gap-1 flex-shrink-0">
                            <Clock size={10} />{note.time}
                          </span>
                        )}
                      </div>
                    ))}

                    {dayAssignments.map((a: any) => {
                      const place = a.place
                      if (!place) return null
                      return (
                        <button
                          key={`a-${a.id}`}
                          type="button"
                          onClick={() => setSelectedActivity(a)}
                          className="flex items-center gap-3 w-full text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
                        >
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
                            style={{ background: place.category?.color || '#6366f1' }}
                          >
                            {place.image_url
                              ? <img src={place.image_url} alt="" className="w-full h-full object-cover" />
                              : <MapPin size={12} color="white" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                              {place.name}
                            </div>
                            {(place.address || place.description) && (
                              <div className="text-xs text-zinc-400 truncate">
                                {place.address || place.description}
                              </div>
                            )}
                          </div>
                          {place.place_time && (
                            <span className="text-xs text-zinc-400 flex items-center gap-1 flex-shrink-0">
                              <Clock size={10} />
                              {place.place_time}
                              {place.end_time ? ` – ${place.end_time}` : ''}
                            </span>
                          )}
                          {place.files?.length > 0 && (
                            <span
                              data-testid="file-count-badge"
                              className="text-xs text-zinc-400 flex items-center gap-1 flex-shrink-0"
                            >
                              <Paperclip size={10} />
                              {place.files.length}
                            </span>
                          )}
                          <ChevronRight size={12} className="ml-auto flex-shrink-0 text-zinc-300" />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </section>

        {/* Unplanned Activities */}
        {unplannedPlaces.length > 0 && (
          <UnplannedActivitiesSection
            unplannedPlaces={unplannedPlaces}
            onSelect={setSelectedActivity}
            t={t}
            locale={locale}
          />
        )}

        {/* RSVP section */}
        <section data-testid="rsvp-section" aria-label="RSVP" className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-6 mb-8">
          <h2 data-testid="rsvp-section-heading" className="text-base font-bold text-zinc-900 dark:text-white mb-1">{t(rsvpHeadingKey)}</h2>
          <p data-testid="rsvp-section-subheading" className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">{t(rsvpSubheadingKey)}</p>
          <RsvpForm
            tripId={id!}
            isMember={isMember}
            rsvpDeadline={rsvpDeadlineVal}
            registrationFee={data?.trip?.registration_fee ?? null}
            feeMode={data?.trip?.fee_mode ?? null}
            feeDeadline={data?.trip?.fee_deadline ?? null}
            currency={data?.trip?.fee_currency ?? data?.trip?.currency ?? 'NOK'}
            paypalClientId={data?.trip?.paypalClientId ?? null}
          />
        </section>

      </div>

      {/* Activity detail modal */}
      {selectedActivity && (
        <PublicActivityModal
          assignment={selectedActivity}
          tripCurrency={trip.currency}
          budgetItems={budgetItems}
          onClose={() => setSelectedActivity(null)}
        />
      )}
    </div>
  )
}
