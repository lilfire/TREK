import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Calendar, Loader2 } from 'lucide-react'
import { publicTripsApi, type PublicTripSummary } from '../api/client'
import { useToast } from '../components/shared/Toast'
import { type DashboardTrip } from './DashboardTripCards'
import { formatDateRange } from '../utils/formatters'

interface Props {
  userTrips: DashboardTrip[]
}

export default function DashboardDiscoverTab({ userTrips }: Props) {
  const navigate = useNavigate()
  const toast = useToast()
  const [publicTrips, setPublicTrips] = useState<PublicTripSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState<number | null>(null)

  const userTripIds = new Set(userTrips.map(t => t.id))

  useEffect(() => {
    publicTripsApi
      .list()
      .then((data: PublicTripSummary[]) => setPublicTrips(data))
      .catch(() => setPublicTrips([]))
      .finally(() => setLoading(false))
  }, [])

  const discoverTrips = publicTrips.filter(t => !userTripIds.has(t.id))

  async function handleJoinTrip(tripId: number) {
    setJoining(tripId)
    try {
      const result = await publicTripsApi.rsvpAuthenticated(tripId)
      if (result?.alreadyMember) {
        toast.success("You're already on the list for this trip.")
      } else {
        toast.success("🎉 You've joined the trip! It will appear in My Trips shortly.")
      }
      navigate('/dashboard')
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setJoining(null)
    }
  }

  if (loading) {
    return (
      <div data-testid="discover-loading" className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    )
  }

  if (discoverTrips.length === 0) {
    return (
      <div
        data-testid="discover-empty"
        className="flex flex-col items-center justify-center py-24 text-center"
      >
        <div className="text-5xl mb-4">🗺️</div>
        <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">No public trips to discover right now.</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Check back later — more trips may be added soon.</p>
      </div>
    )
  }

  return (
    <div
      data-testid="discover-grid"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      {discoverTrips.map(trip => (
        <div
          key={trip.id}
          data-testid="discover-card"
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-600 transition-all"
        >
          {trip.cover_image_url ? (
            <div
              className="h-36 overflow-hidden cursor-pointer"
              onClick={() => navigate(`/public/trips/${trip.id}`)}
            >
              <img
                src={trip.cover_image_url.startsWith('http') || trip.cover_image_url.startsWith('/') ? trip.cover_image_url : `/uploads/${trip.cover_image_url}`}
                alt=""
                className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
              />
            </div>
          ) : (
            <div
              className="h-36 flex items-center justify-center cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
              onClick={() => navigate(`/public/trips/${trip.id}`)}
              aria-hidden="true"
            >
              <span className="text-4xl opacity-30">✈️</span>
            </div>
          )}

          <div className="p-4">
            <h3
              data-testid="discover-trip-name"
              className="text-sm font-semibold text-zinc-900 dark:text-white truncate mb-1"
            >
              {trip.name}
            </h3>

            {(trip.start_date || trip.end_date) && (
              <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                <Calendar size={11} className="flex-shrink-0" />
                <span>{formatDateRange(trip.start_date, trip.end_date)}</span>
              </div>
            )}

            <div className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500 mb-3">
              <MapPin size={11} className="flex-shrink-0" />
              <span>{trip.place_count} {trip.place_count === 1 ? 'place' : 'places'}</span>
            </div>

            <button
              type="button"
              data-testid="discover-join-btn"
              disabled={joining === trip.id}
              onClick={() => handleJoinTrip(trip.id)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {joining === trip.id && <Loader2 size={12} className="animate-spin" />}
              {joining === trip.id ? 'Joining...' : 'Join Trip'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
