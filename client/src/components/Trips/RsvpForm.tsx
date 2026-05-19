import { useState } from 'react'

interface Props {
  tripId: number | string
}

type Status = 'idle' | 'submitting' | 'done' | 'error'

export default function RsvpForm({ tripId: _tripId }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setStatus('submitting')
    try {
      // RSVP submission endpoint will be wired when the backend is ready
      await Promise.resolve()
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div data-testid="rsvp-success" className="text-center py-6 text-green-600 dark:text-green-400 font-medium">
        Thanks! Your RSVP has been recorded.
      </div>
    )
  }

  return (
    <form data-testid="rsvp-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
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
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
        />
      </div>
      {status === 'error' && (
        <p className="text-sm text-red-600 dark:text-red-400">Something went wrong. Please try again.</p>
      )}
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {status === 'submitting' ? 'Sending…' : 'RSVP'}
      </button>
    </form>
  )
}
