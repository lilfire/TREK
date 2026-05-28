import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MapPin, Calendar } from 'lucide-react'
import { publicTripsApi } from '../api/client'

interface PublicTripSummary {
  id: number
  name: string
  start_date: string | null
  end_date: string | null
  cover_image_url: string | null
  description: string | null
  place_count: number
}

function formatDateRange(start: string | null, end: string | null): string {
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00Z').toLocaleDateString('en', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    })
  if (start && end) return `${fmt(start)} — ${fmt(end)}`
  if (start) return fmt(start)
  if (end) return fmt(end)
  return ''
}

export default function PublicTripsPage() {
  const navigate = useNavigate()
  const [trips, setTrips] = useState<PublicTripSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    publicTripsApi
      .list()
      .then((data: PublicTripSummary[]) => setTrips(data))
      .catch(() => setTrips([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header
        className="relative text-white text-center"
        style={{ background: 'linear-gradient(135deg, #000 0%, #0f172a 50%, #1e293b 100%)', padding: '32px 20px 28px', overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />
        <div style={{ position: 'absolute', bottom: -40, left: -40, width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,0.02)' }} />

        {/* Login / Register links */}
        <nav className="absolute top-3 right-3 flex gap-2" aria-label="Account navigation">
          <Link
            to="/login"
            data-testid="login-link"
            className="text-xs font-medium px-3 py-1.5 rounded-full border border-white/20 bg-white/10 text-white/80 hover:bg-white/20 transition-colors"
          >
            Login
          </Link>
          <Link
            to="/register"
            data-testid="register-link"
            className="text-xs font-medium px-3 py-1.5 rounded-full border border-white/20 bg-white/10 text-white/80 hover:bg-white/20 transition-colors"
          >
            Register
          </Link>
        </nav>

        <div className="relative">
          <div
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', marginBottom: 12, border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <img src="/icons/icon-white.svg" alt="TREK" width={26} height={26} />
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', opacity: 0.35, marginBottom: 8 }}>
            Travel Resource &amp; Exploration Kit
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">Explore Trips</h1>
          <p style={{ fontSize: 13, opacity: 0.5 }}>Browse publicly shared travel itineraries</p>
        </div>
      </header>

      {/* Trip grid */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {trips.length === 0 ? (
          <div
            data-testid="empty-state"
            className="flex flex-col items-center justify-center py-24 text-center"
          >
            <div className="text-5xl mb-4">🗺️</div>
            <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">No public trips yet</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Check back later — trip planners can make their itineraries public here.</p>
          </div>
        ) : (
          <div
            data-testid="trips-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {trips.map(trip => (
              <button
                key={trip.id}
                type="button"
                data-testid="trip-card"
                onClick={() => navigate(`/public/trips/${trip.id}`)}
                className="group text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-600 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-white"
                aria-label={`View trip: ${trip.name}`}
              >
                {/* Cover image */}
                {trip.cover_image_url ? (
                  <div className="h-36 overflow-hidden">
                    <img
                      src={trip.cover_image_url.startsWith('http') || trip.cover_image_url.startsWith('/') ? trip.cover_image_url : `/uploads/${trip.cover_image_url}`}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                ) : (
                  <div
                    className="h-36 flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
                    aria-hidden="true"
                  >
                    <span className="text-4xl opacity-30">✈️</span>
                  </div>
                )}

                {/* Card body */}
                <div className="p-4">
                  <h2
                    data-testid="trip-name"
                    className="text-sm font-semibold text-zinc-900 dark:text-white truncate mb-1 group-hover:text-zinc-700 dark:group-hover:text-zinc-200 transition-colors"
                  >
                    {trip.name}
                  </h2>

                  {(trip.start_date || trip.end_date) && (
                    <div
                      data-testid="trip-dates"
                      className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 mb-2"
                    >
                      <Calendar size={11} className="flex-shrink-0" />
                      <span>{formatDateRange(trip.start_date, trip.end_date)}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
                    <MapPin size={11} className="flex-shrink-0" />
                    <span data-testid="trip-place-count">{trip.place_count} {trip.place_count === 1 ? 'place' : 'places'}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <div className="flex flex-col items-center pb-8">
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 20, background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <img src="/icons/icon.svg" alt="TREK" width={18} height={18} style={{ borderRadius: 4 }} />
          <span style={{ fontSize: 11, color: '#9ca3af' }}>Powered by <strong style={{ color: '#6b7280' }}>TREK</strong></span>
        </div>
      </div>
    </div>
  )
}
