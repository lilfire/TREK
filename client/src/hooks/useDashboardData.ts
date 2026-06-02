import { useState, useEffect } from 'react'
import { tripsApi } from '../api/client'
import { tripRepo } from '../repo/tripRepo'
import { useToast } from '../components/shared/Toast'
import { useTranslation } from '../i18n'
import { getApiErrorMessage } from '../types'
import { type DashboardTrip, sortTrips } from '../pages/DashboardTripCards'

export interface UseDashboardDataResult {
  trips: DashboardTrip[]
  archivedTrips: DashboardTrip[]
  isLoading: boolean
  loadTrips: () => Promise<void>
  handleCreate: (tripData: Record<string, unknown>) => Promise<unknown>
  handleUpdate: (editingTripId: number, tripData: Record<string, unknown>) => Promise<void>
  handleDelete: (trip: DashboardTrip) => void
  confirmDelete: () => Promise<void>
  handleArchive: (id: number) => Promise<void>
  handleUnarchive: (id: number) => Promise<void>
  handleCoverUpdate: (tripId: number, coverImage: string | null) => void
  handleCopy: (trip: DashboardTrip) => void
  confirmCopy: () => Promise<void>
  deleteTrip: DashboardTrip | null
  copyTrip: DashboardTrip | null
  setDeleteTrip: (trip: DashboardTrip | null) => void
  setCopyTrip: (trip: DashboardTrip | null) => void
}

export function useDashboardData(): UseDashboardDataResult {
  const [trips, setTrips] = useState<DashboardTrip[]>([])
  const [archivedTrips, setArchivedTrips] = useState<DashboardTrip[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deleteTrip, setDeleteTrip] = useState<DashboardTrip | null>(null)
  const [copyTrip, setCopyTrip] = useState<DashboardTrip | null>(null)

  const toast = useToast()
  const { t } = useTranslation()

  useEffect(() => { loadTrips() }, [])

  async function loadTrips() {
    setIsLoading(true)
    try {
      const result = await tripRepo.list()
      setTrips(sortTrips(result.trips))
      setArchivedTrips(sortTrips(result.archivedTrips))
    } catch {
      toast.error(t('dashboard.toast.loadError'))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCreate(tripData: Record<string, unknown>) {
    try {
      const data = await tripsApi.create(tripData)
      setTrips(prev => sortTrips([data.trip, ...prev]))
      toast.success(t('dashboard.toast.created'))
      return data
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, t('dashboard.toast.createError')))
    }
  }

  async function handleUpdate(editingTripId: number, tripData: Record<string, unknown>) {
    try {
      const data = await tripsApi.update(editingTripId, tripData)
      setTrips(prev => sortTrips(prev.map(t => t.id === editingTripId ? data.trip : t)))
      toast.success(t('dashboard.toast.updated'))
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, t('dashboard.toast.updateError')))
    }
  }

  function handleDelete(trip: DashboardTrip) { setDeleteTrip(trip) }

  async function confirmDelete() {
    if (!deleteTrip) return
    try {
      await tripsApi.delete(deleteTrip.id)
      setTrips(prev => prev.filter(t => t.id !== deleteTrip.id))
      setArchivedTrips(prev => prev.filter(t => t.id !== deleteTrip.id))
      toast.success(t('dashboard.toast.deleted'))
    } catch {
      toast.error(t('dashboard.toast.deleteError'))
    }
    setDeleteTrip(null)
  }

  async function handleArchive(id: number) {
    try {
      const data = await tripsApi.archive(id)
      setTrips(prev => prev.filter(t => t.id !== id))
      setArchivedTrips(prev => sortTrips([data.trip, ...prev]))
      toast.success(t('dashboard.toast.archived'))
    } catch {
      toast.error(t('dashboard.toast.archiveError'))
    }
  }

  async function handleUnarchive(id: number) {
    try {
      const data = await tripsApi.unarchive(id)
      setArchivedTrips(prev => prev.filter(t => t.id !== id))
      setTrips(prev => sortTrips([data.trip, ...prev]))
      toast.success(t('dashboard.toast.restored'))
    } catch {
      toast.error(t('dashboard.toast.restoreError'))
    }
  }

  function handleCoverUpdate(tripId: number, coverImage: string | null) {
    const update = (t: DashboardTrip) => t.id === tripId ? { ...t, cover_image: coverImage } : t
    setTrips(prev => prev.map(update))
    setArchivedTrips(prev => prev.map(update))
  }

  function handleCopy(trip: DashboardTrip) { setCopyTrip(trip) }

  async function confirmCopy() {
    if (!copyTrip) return
    try {
      const data = await tripsApi.copy(copyTrip.id, { title: `${copyTrip.title} (${t('dashboard.copySuffix')})` })
      setTrips(prev => sortTrips([data.trip, ...prev]))
      toast.success(t('dashboard.toast.copied'))
    } catch {
      toast.error(t('dashboard.toast.copyError'))
    }
    setCopyTrip(null)
  }

  return {
    trips, archivedTrips, isLoading, loadTrips,
    handleCreate, handleUpdate,
    handleDelete, confirmDelete, setDeleteTrip, deleteTrip,
    handleArchive, handleUnarchive,
    handleCoverUpdate,
    handleCopy, confirmCopy, setCopyTrip, copyTrip,
  }
}
