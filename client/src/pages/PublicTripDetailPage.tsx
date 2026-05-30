import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, Clock, FileText, ChevronRight, ExternalLink, Phone, X } from 'lucide-react'
import { publicTripsApi } from '../api/client'
import { useTranslation, SUPPORTED_LANGUAGES } from '../i18n'
import { useSettingsStore } from '../store/settingsStore'
import RsvpForm from '../components/Trips/RsvpForm'

function mimeAbbr(mimeType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WEBP',
    'video/mp4': 'MP4',
    'video/quicktime': 'MOV',
    'application/zip': 'ZIP',
  }
  return map[mimeType] || mimeType.split('/')[1]?.toUpperCase().slice(0, 4) || 'FILE'
}

function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null) return null
  if (bytes < 1024) return '< 1 KB'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

  const { trip, days, assignments, dayNotes } = data
  const sortedDays: any[] = [...(days || [])].sort((a: any, b: any) => a.day_number - b.day_number)

  function toggleDay(dayId: number) {
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (next.has(dayId)) next.delete(dayId)
      else next.add(dayId)
      return next
    })
  }

  function formatDate(d: string) {
    return new Date(d + 'T00:00:00Z').toLocaleDateString(locale, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    })
  }

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

        {/* Language picker - top right */}
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
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
                position: 'absolute', top: '100%', right: 0, marginTop: 6, background: 'white',
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
                    textAlign: 'left', cursor: 'pointer', fontSize: 12, color: '#374151', borderRadius: 6, fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', marginBottom: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
            <img src="/icons/icon-white.svg" alt="TREK" width={26} height={26} />
          </div>

          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', opacity: 0.35, marginBottom: 12 }}>
            Travel Resource &amp; Exploration Kit
          </div>

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
                    style={{ background: isExpanded ? '#18181b' : '#f4f4f5', color: isExpanded ? 'white' : '#71717a' }}
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

        {/* RSVP section */}
        <section data-testid="rsvp-section" aria-label="RSVP" className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-6 mb-8">
          <h2 className="text-base font-bold text-zinc-900 dark:text-white mb-1">{t('publicTrip.rsvp.heading')}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">{t('publicTrip.rsvp.subheading')}</p>
          <RsvpForm
            tripId={id!}
            isMember={data?.trip?.user_is_member === true}
            rsvpDeadline={data?.trip?.rsvp_deadline ?? null}
            registrationFee={data?.trip?.registration_fee ?? null}
            feeMode={data?.trip?.fee_mode ?? null}
            feeDeadline={data?.trip?.fee_deadline ?? null}
            currency={data?.trip?.currency ?? 'NOK'}
            paypalClientId={data?.trip?.paypalClientId ?? null}
          />
        </section>

        {/* Footer */}
        <div className="flex flex-col items-center py-4 gap-2">
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 20, background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <img src="/icons/icon.svg" alt="TREK" width={18} height={18} style={{ borderRadius: 4 }} />
            <span style={{ fontSize: 11, color: '#9ca3af' }}>Shared via <strong style={{ color: '#6b7280' }}>TREK</strong></span>
          </div>
        </div>
      </div>

      {/* Activity detail modal / bottom-sheet */}
      {selectedActivity && (() => {
        const place = selectedActivity.place
        const files: any[] = place.files || []

        return (
          <div
            data-testid="activity-modal"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
            onClick={() => setSelectedActivity(null)}
          >
            <div
              className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto"
              style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start gap-3 p-5 border-b border-zinc-100 dark:border-zinc-800">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: place.category?.color || '#6366f1' }}
                >
                  {place.image_url
                    ? <img src={place.image_url} alt="" className="w-full h-full object-cover rounded-xl" />
                    : <MapPin size={14} color="white" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-zinc-900 dark:text-white leading-tight">
                    {place.name}
                  </h3>
                  {place.category && (
                    <span className="text-xs text-zinc-400">{place.category.name}</span>
                  )}
                </div>
                <button
                  aria-label="Close"
                  onClick={() => setSelectedActivity(null)}
                  className="flex-shrink-0 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 flex flex-col gap-4">
                {/* Description */}
                {place.description && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                    {truncateText(place.description)}
                  </p>
                )}

                {/* Notes */}
                {place.notes && (
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-sm text-zinc-600 dark:text-zinc-300">
                    {truncateText(place.notes)}
                  </div>
                )}

                {/* Info rows */}
                <div className="flex flex-col gap-2.5">
                  {place.address && (
                    <div className="flex items-start gap-2.5 text-sm">
                      <MapPin size={14} className="flex-shrink-0 mt-0.5 text-zinc-400" />
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.address)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                      >
                        {place.address}
                      </a>
                    </div>
                  )}

                  {(place.place_time || place.end_time) && (
                    <div className="flex items-center gap-2.5 text-sm">
                      <Clock size={14} className="flex-shrink-0 text-zinc-400" />
                      <span className="text-zinc-600 dark:text-zinc-300">
                        {place.place_time}
                        {place.end_time
                          ? ` – ${place.end_time}`
                          : place.duration_minutes
                            ? ` (${formatDuration(place.duration_minutes)})`
                            : ''}
                      </span>
                    </div>
                  )}

                  {place.website && (
                    <div className="flex items-center gap-2.5 text-sm">
                      <ExternalLink size={14} className="flex-shrink-0 text-zinc-400" />
                      <a
                        href={place.website}
                        target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline truncate"
                      >
                        {place.website.replace(/^https?:\/\//, '')}
                      </a>
                    </div>
                  )}

                  {place.phone && (
                    <div className="flex items-center gap-2.5 text-sm">
                      <Phone size={14} className="flex-shrink-0 text-zinc-400" />
                      <a href={`tel:${place.phone}`} className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900">
                        {place.phone}
                      </a>
                    </div>
                  )}

                  {(place.price != null && place.price > 0) && (
                    <div className="flex items-center gap-2.5 text-sm">
                      <span className="text-zinc-400 text-xs font-mono w-3.5 text-center flex-shrink-0">$</span>
                      <span className="text-zinc-600 dark:text-zinc-300">
                        {Number(place.price).toLocaleString()} {place.currency || trip.currency || 'NOK'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Files — metadata-only; no URLs available on public page */}
                {files.length > 0 && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                      Files ({files.length})
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {files.map((f: any) => {
                        const size = formatFileSize(f.file_size)
                        return (
                          <div key={f.id} className="flex items-center gap-2.5 text-sm text-zinc-600 dark:text-zinc-300 py-1">
                            <FileText size={13} className="flex-shrink-0 text-zinc-400" />
                            <span className="truncate flex-1">{f.original_name}</span>
                            <span className="ml-auto text-xs text-zinc-400 flex-shrink-0">
                              {mimeAbbr(f.mime_type || '')}{size ? `, ${size}` : ''}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
