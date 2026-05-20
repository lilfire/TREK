import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { publicTripsApi } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import { useToast } from '../shared/Toast'
import { getApiErrorMessage } from '../../types'

interface Props {
  tripId: number | string
}

export default function RsvpForm({ tripId }: Props) {
  const navigate = useNavigate()
  const toast = useToast()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isAuthenticated) {
    return (
      <div data-testid="rsvp-already-registered" className="text-sm text-zinc-600 dark:text-zinc-400 py-2">
        You&apos;re already on the list.
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (!email.trim()) {
      setError('Email is required.')
      return
    }

    setSubmitting(true)
    try {
      const data = await publicTripsApi.rsvp(tripId, {
        name: name.trim(),
        email: email.trim(),
        message: message.trim() || undefined,
      })
      useAuthStore.setState({
        user: data.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      })
      toast.success("You're in! You've been registered and added to this trip.")
      navigate('/dashboard')
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Something went wrong. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form data-testid="rsvp-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div>
        <label htmlFor="rsvp-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Name
        </label>
        <input
          id="rsvp-name"
          type="text"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="rsvp-email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Email
        </label>
        <input
          id="rsvp-email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="rsvp-message" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Message <span className="text-zinc-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="rsvp-message"
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Anything you'd like the organiser to know…"
          rows={3}
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white resize-none disabled:opacity-50"
        />
      </div>

      {error && (
        <p data-testid="rsvp-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {submitting && <Loader2 size={14} className="animate-spin" />}
        {submitting ? 'Sending…' : 'RSVP'}
      </button>
    </form>
  )
}
