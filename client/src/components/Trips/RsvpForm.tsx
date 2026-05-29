import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js'
import { publicTripsApi, apiClient } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'

interface Props {
  tripId: number | string
  isMember?: boolean
  registrationFee?: number | null
  feeMode?: 'deadline' | 'rsvp' | null
  feeDeadline?: string | null
  currency?: string
  paypalClientId?: string | null
  rsvpDeadline?: string | null
}

interface RsvpError {
  message: string
  hasLoginLink: boolean
}

type TFunction = (key: string, params?: Record<string, string | number>) => string

export function parseRsvpError(t: TFunction, err: unknown): RsvpError {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const apiErr = err as { response?: { status?: number; data?: { error?: string } } }
    const status = apiErr.response?.status
    const errorCode = apiErr.response?.data?.error

    if (status === 409) {
      if (errorCode === 'duplicate_rsvp') {
        return { message: t('rsvp.error.duplicateRsvp'), hasLoginLink: false }
      }
      return { message: t('rsvp.error.emailConflict'), hasLoginLink: true }
    }
    if (status === 404) {
      return { message: t('rsvp.error.notFound'), hasLoginLink: false }
    }
    if (status === 429) {
      return { message: t('rsvp.error.tooManyAttempts'), hasLoginLink: false }
    }
    if (status === 400 && errorCode === 'rsvp.error.registrationClosed') {
      return { message: t('rsvp.error.registrationClosed'), hasLoginLink: false }
    }
    if (status && status >= 500) {
      return { message: t('rsvp.error.serverError'), hasLoginLink: false }
    }
    if (errorCode) {
      return { message: String(errorCode), hasLoginLink: false }
    }
  }
  if (err instanceof Error) return { message: err.message, hasLoginLink: false }
  return { message: t('rsvp.error.unknown'), hasLoginLink: false }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return dateStr
  }
}

export default function RsvpForm({ tripId, isMember, registrationFee, feeMode, feeDeadline, currency = 'NOK', paypalClientId, rsvpDeadline }: Props) {
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useTranslation()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<RsvpError | null>(null)
  const [joinDone, setJoinDone] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)

  const hasFee = typeof registrationFee === 'number' && registrationFee > 0
  const isDeadlineFee = hasFee && feeMode === 'deadline'
  const isRsvpFee = hasFee && feeMode === 'rsvp'
  const formFieldsValid = name.trim().length > 0 && email.trim().length > 0

  const today = new Date().toISOString().split('T')[0]
  const rsvpClosed = rsvpDeadline != null && today > rsvpDeadline
  const rsvpOpenWithDeadline = rsvpDeadline != null && today <= rsvpDeadline

  async function handleJoin() {
    setError(null)
    setSubmitting(true)
    try {
      const result = await publicTripsApi.rsvpAuthenticated(tripId)
      if (!result?.alreadyMember) {
        toast.success(t('rsvp.toastJoined'))
      }
      setJoinDone(true)
    } catch (err: unknown) {
      setError(parseRsvpError(t, err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError({ message: t('rsvp.nameRequired'), hasLoginLink: false })
      return
    }
    if (!email.trim()) {
      setError({ message: t('rsvp.emailRequired'), hasLoginLink: false })
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
      toast.success(t('rsvp.toastRegistered'))
      navigate('/dashboard')
    } catch (err: unknown) {
      setError(parseRsvpError(t, err))
    } finally {
      setSubmitting(false)
    }
  }

  if (isAuthenticated && isMember) {
    return (
      <div data-testid="rsvp-on-the-list" className="text-sm text-zinc-600 dark:text-zinc-400 py-2">
        {t('rsvp.onTheList')}{' '}
        <Link to="/dashboard" className="underline font-medium text-zinc-900 dark:text-white">
          {t('rsvp.viewDashboard')}
        </Link>
      </div>
    )
  }

  if (rsvpClosed) {
    return (
      <p data-testid="rsvp-registration-closed" className="text-sm text-zinc-500 dark:text-zinc-400">
        {t('rsvp.registrationClosed')}
      </p>
    )
  }

  if (isAuthenticated && !isMember) {
    if (joinDone) {
      return (
        <div data-testid="rsvp-join-success" className="text-sm text-zinc-600 dark:text-zinc-400 py-2">
          {t('rsvp.onTheList')}{' '}
          <Link to="/dashboard" className="underline font-medium text-zinc-900 dark:text-white">
            {t('rsvp.viewDashboard')}
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
          {submitting ? t('rsvp.joining') : t('rsvp.joinTrip')}
        </button>
      </div>
    )
  }

  const deadlineNotice = rsvpOpenWithDeadline ? (
    <p data-testid="rsvp-deadline-notice" className="text-sm text-zinc-600 dark:text-zinc-400">
      {t('rsvp.deadlineNotice', { date: formatDate(rsvpDeadline!) })}
    </p>
  ) : null

  const formFields = (
    <>
      {deadlineNotice}
      <p data-testid="rsvp-intro" className="text-sm text-zinc-500 dark:text-zinc-400">
        {t('rsvp.intro')}{' '}
        <Link to="/login" className="underline text-zinc-700 dark:text-zinc-300">
          {t('rsvp.alreadyHaveAccount')}
        </Link>
      </p>

      <div>
        <label htmlFor="rsvp-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {t('rsvp.nameLabel')}
        </label>
        <input
          id="rsvp-name"
          type="text"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('rsvp.namePlaceholder')}
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="rsvp-email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {t('rsvp.emailLabel')}
        </label>
        <input
          id="rsvp-email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder={t('rsvp.emailPlaceholder')}
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white disabled:opacity-50"
        />
      </div>

      <p data-testid="rsvp-account-notice" className="text-xs text-zinc-400 dark:text-zinc-500 -mt-1">
        {t('rsvp.accountNotice')}
      </p>

      <div>
        <label htmlFor="rsvp-message" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {t('rsvp.messageLabel')} <span className="text-zinc-400 font-normal">{t('rsvp.messageOptional')}</span>
        </label>
        <textarea
          id="rsvp-message"
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={t('rsvp.messagePlaceholder')}
          rows={3}
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white resize-none disabled:opacity-50"
        />
      </div>
    </>
  )

  // Case B: fee with deadline — show info notice, submit normally
  if (isDeadlineFee) {
    return (
      <form data-testid="rsvp-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {formFields}

        <div data-testid="fee-deadline-notice" className="p-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-200">
          <p className="font-semibold">
            {t('rsvp.feeLabel', { amount: String(registrationFee), currency })}
          </p>
          {feeDeadline && (
            <p className="mt-0.5">
              {t('rsvp.feeDeadline', { date: formatDate(feeDeadline) })}
            </p>
          )}
          <p className="mt-0.5 text-xs opacity-75">
            {t('rsvp.feeInstructions')}
          </p>
        </div>

        {error && (
          <p data-testid="rsvp-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error.message}
            {error.hasLoginLink && (
              <>
                {' '}
                <Link to="/login" className="underline font-medium">
                  {t('rsvp.logInHere')}
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
          {submitting ? t('rsvp.confirming') : t('rsvp.confirmMySpot')}
        </button>
      </form>
    )
  }

  // Case C: fee at registration — PayPal payment required
  if (isRsvpFee && paypalClientId) {
    if (paymentSuccess) {
      return (
        <div data-testid="rsvp-payment-success" className="p-4 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
          {t('rsvp.paymentSuccess', { amount: String(registrationFee), currency })}
        </div>
      )
    }

    return (
      <div data-testid="rsvp-form" className="flex flex-col gap-4">
        {formFields}

        {error && (
          <p data-testid="rsvp-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error.message}
            {error.hasLoginLink && (
              <>
                {' '}
                <Link to="/login" className="underline font-medium">
                  {t('rsvp.logInHere')}
                </Link>
              </>
            )}
          </p>
        )}

        <div data-testid="paypal-fee-notice" className="text-sm text-zinc-600 dark:text-zinc-400">
          {t('rsvp.paypalFeeNotice', { amount: String(registrationFee), currency })}
        </div>

        <div data-testid="paypal-button-wrapper" className={!formFieldsValid ? 'opacity-50 pointer-events-none' : ''}>
          <PayPalScriptProvider options={{ clientId: paypalClientId, currency: currency.toUpperCase() }}>
            <PayPalButtons
              disabled={!formFieldsValid || submitting}
              forceReRender={[name, email]}
              createOrder={async () => {
                const result = await publicTripsApi.createPaymentOrder(tripId, {
                  amount: registrationFee!,
                  currency: currency.toUpperCase(),
                })
                return result.orderId
              }}
              onApprove={async (_data, actions) => {
                setSubmitting(true)
                setError(null)
                try {
                  const rsvpData = await publicTripsApi.rsvp(tripId, {
                    name: name.trim(),
                    email: email.trim(),
                    message: message.trim() || undefined,
                  })
                  apiClient.defaults.headers.common['Authorization'] = `Bearer ${rsvpData.authToken}`

                  await publicTripsApi.capturePayment(tripId, {
                    orderId: actions.orderID ?? (_data as any).orderID,
                    rsvpId: rsvpData.rsvpId,
                  })

                  await useAuthStore.getState().loadUser()
                  setPaymentSuccess(true)
                } catch (err: unknown) {
                  setError(parseRsvpError(t, err))
                } finally {
                  setSubmitting(false)
                }
              }}
              onError={() => {
                setError({ message: t('rsvp.paymentNotCompleted'), hasLoginLink: false })
              }}
              onCancel={() => {
                setError({ message: t('rsvp.paymentNotCompleted'), hasLoginLink: false })
              }}
            />
          </PayPalScriptProvider>
        </div>
      </div>
    )
  }

  // Case C-fallback: fee_mode is 'rsvp' but PayPal is not configured
  if (isRsvpFee && !paypalClientId) {
    return (
      <div
        data-testid="rsvp-payment-unavailable"
        className="p-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800 text-sm text-yellow-800 dark:text-yellow-200"
      >
        {t('rsvp.paymentUnavailable')}
      </div>
    )
  }

  // Case A: no fee — standard form
  return (
    <form data-testid="rsvp-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {formFields}

      {error && (
        <p data-testid="rsvp-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error.message}
          {error.hasLoginLink && (
            <>
              {' '}
              <Link to="/login" className="underline font-medium">
                {t('rsvp.logInHere')}
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
        {submitting ? t('rsvp.confirming') : t('rsvp.confirmMySpot')}
      </button>
    </form>
  )
}
