import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { publicTripsApi, apiClient } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import { useToast } from '../shared/Toast'

interface Props {
  tripId: number | string
  isMember?: boolean
}

interface RsvpError {
  message: string
  hasLoginLink: boolean
}

function parseRsvpError(err: unknown): RsvpError {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const apiErr = err as { response?: { status?: number; data?: { error?: string } } }
    const status = apiErr.response?.status
    const errorCode = apiErr.response?.data?.error

    if (status === 409) {
      if (errorCode === 'duplicate_rsvp') {
        return { message: "You're already on the list for this trip. Check your inbox for confirmation details.", hasLoginLink: false }
      }
      return { message: "This email is linked to a TREK account. Please log in to RSVP.", hasLoginLink: true }
    }
    if (status === 404) {
      return { message: "This trip is no longer accepting RSVPs.", hasLoginLink: false }
    }
    if (status === 429) {
      return { message: "Too many attempts. Please wait a few minutes before trying again.", hasLoginLink: false }
    }
    if (status && status >= 500) {
      return { message: "Something went wrong on our end. Please try again shortly.", hasLoginLink: false }
    }
    if (errorCode) {
      return { message: String(errorCode), hasLoginLink: false }
    }
  }
  if (err instanceof Error) return { message: err.message, hasLoginLink: false }
  return { message: "Something went wrong. Please try again.", hasLoginLink: false }
}

export default function RsvpForm({ tripId, isMember }: Props) {
  const navigate = useNavigate()
  const toast = useToast()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<RsvpError | null>(null)
  const [joinDone, setJoinDone] = useState(false)

  async function handleJoin() {
    setError(null)
    setSubmitting(true)
    try {
      const result = await publicTripsApi.rsvpAuthenticated(tripId)
      if (!result?.alreadyMember) {
        toast.success("🎉 You're in! Check your dashboard to view the full itinerary.")
      }
      setJoinDone(true)
    } catch (err: unknown) {
      setError(parseRsvpError(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError({ message: 'Name is required.', hasLoginLink: false })
      return
    }
    if (!email.trim()) {
      setError({ message: 'Email is required.', hasLoginLink: false })
      return
    }

    setSubmitting(true)
    try {
      const data = await publicTripsApi.rsvp(tripId, {
        name: name.trim(),
        email: email.trim(),
        message: message.trim() || undefined,
      })
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.authToken}`
      await useAuthStore.getState().loadUser()
      toast.success("🎉 You're in! Welcome to TREK — check your inbox for a confirmation email.")
      navigate('/dashboard')
    } catch (err: unknown) {
      setError(parseRsvpError(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (isAuthenticated && isMember) {
    return (
      <div data-testid="rsvp-on-the-list" className="text-sm text-zinc-600 dark:text-zinc-400 py-2">
        You&apos;re on the list.{' '}
        <Link to="/dashboard" className="underline font-medium text-zinc-900 dark:text-white">
          View the trip in your dashboard &rarr;
        </Link>
      </div>
    )
  }

  if (isAuthenticated && !isMember) {
    if (joinDone) {
      return (
        <div data-testid="rsvp-join-success" className="text-sm text-zinc-600 dark:text-zinc-400 py-2">
          You&apos;re on the list.{' '}
          <Link to="/dashboard" className="underline font-medium text-zinc-900 dark:text-white">
            View the trip in your dashboard &rarr;
          </Link>
        </div>
      )
    }

    return (
      <div data-testid="rsvp-join-form" className="flex flex-col gap-4">
        {error && (
          <p data-testid="rsvp-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error.message}
          </p>
        )}
        <button
          type="button"
          data-testid="rsvp-join-btn"
          disabled={submitting}
          onClick={handleJoin}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Joining...' : 'Join Trip'}
        </button>
      </div>
    )
  }

  return (
    <form data-testid="rsvp-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <p data-testid="rsvp-intro" className="text-sm text-zinc-500 dark:text-zinc-400">
        We&apos;ll create a TREK account for you so you can access the full itinerary.{' '}
        <Link to="/login" className="underline text-zinc-700 dark:text-zinc-300">
          Already have an account? Log in
        </Link>
      </p>

      <div>
        <label htmlFor="rsvp-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Your name
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
          Email address
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

      <p data-testid="rsvp-account-notice" className="text-xs text-zinc-400 dark:text-zinc-500 -mt-1">
        A TREK account will be created using this email address.
      </p>

      <div>
        <label htmlFor="rsvp-message" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Message <span className="text-zinc-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="rsvp-message"
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Anything you'd like the organiser to know..."
          rows={3}
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white resize-none disabled:opacity-50"
        />
      </div>

      {error && (
        <p data-testid="rsvp-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error.message}
          {error.hasLoginLink && (
            <>
              {' '}
              <Link to="/login" className="underline font-medium">
                Log in here
              </Link>
            </>
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {submitting && <Loader2 size={14} className="animate-spin" />}
        {submitting ? 'Confirming...' : 'Confirm my spot'}
      </button>
    </form>
  )
}
