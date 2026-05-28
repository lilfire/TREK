import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, Clock, FileText } from 'lucide-react'
import { publicTripsApi } from '../api/client'
import { useTranslation } from '../i18n'
import RsvpForm from '../components/Trips/RsvpForm'

export default function PublicTripDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { locale } = useTranslation()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set())

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
        style={{ background: 'linear-gradient(135deg, #000 0%, #0f172a 50%, #1e293b 100%)', padding: '32px 20px 28px', overflow: 'hidden' }}
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
                        <div key={`a-${a.id}`} className="flex items-center gap-3">
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
                        </div>
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
          <h2 className="text-base font-bold text-zinc-900 dark:text-white mb-1">Join this trip</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">Add your details below and we&apos;ll reserve your spot.</p>
          <RsvpForm tripId={id!} />
        </section>

        {/* Footer */}
        <div className="flex flex-col items-center py-4 gap-2">
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 20, background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <img src="/icons/icon.svg" alt="TREK" width={18} height={18} style={{ borderRadius: 4 }} />
            <span style={{ fontSize: 11, color: '#9ca3af' }}>Shared via <strong style={{ color: '#6b7280' }}>TREK</strong></span>
          </div>
        </div>
      </div>
    </div>
  )
}
