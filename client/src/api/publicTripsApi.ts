import { apiClient } from './client'

export interface PublicTripSummary {
  id: number
  name: string
  start_date: string | null
  end_date: string | null
  cover_image_url: string | null
  description: string | null
  place_count: number
}

export const publicTripsApi = {
  list: (): Promise<PublicTripSummary[]> => apiClient.get('/public/trips').then(r => r.data),
  get: (id: number | string) => apiClient.get(`/public/trips/${id}`).then(r => r.data),
  rsvp: (id: number | string, data: { name: string; email: string; message?: string }) =>
    apiClient.post(`/public/trips/${id}/rsvp`, data).then(r => r.data),
  rsvpAuthenticated: (id: number | string): Promise<{ alreadyMember?: boolean }> =>
    apiClient.post(`/public/trips/${id}/rsvp`, {}).then(r => r.data),
}
