import { BedDouble, Check, ExternalLink, Lock, Map as MapIcon, MapPin, Users } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { AccommodationTierStatus, AccommodationTierWithState } from '../../types'

interface Props {
  status: AccommodationTierStatus
  requiresPayment: boolean
}

/** Only allow http(s) links from place data */
function safeUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** Name + address search so Maps opens the business listing (with photos); coordinates as fallback */
function mapsUrl(tier: AccommodationTierWithState): string | null {
  const query = [tier.place_name, tier.place_address].filter(Boolean).join(', ')
    || (tier.place_lat != null && tier.place_lng != null ? `${tier.place_lat},${tier.place_lng}` : '')
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null
}

export default function AccommodationTierList({ status, requiresPayment }: Props) {
  const { t } = useTranslation()
  const { participant_count: count, next_tier: next, tiers } = status

  // Progress from the active tier's threshold (or 0) toward the next threshold
  const active = tiers.find(tier => tier.is_active)
  const from = active?.min_participants ?? 0
  const progress = next
    ? Math.min(100, Math.max(0, ((count - from) / (next.min_participants - from)) * 100))
    : 100

  function rangeLabel(tier: AccommodationTierWithState): string {
    if (tier.max_participants === null) return t('publicTrip.tiers.rangeOpen', { min: tier.min_participants })
    if (tier.max_participants === tier.min_participants) return t('publicTrip.tiers.rangeSingle', { min: tier.min_participants })
    return t('publicTrip.tiers.range', { min: tier.min_participants, max: tier.max_participants })
  }

  return (
    <section
      data-testid="accommodation-tiers"
      aria-label={t('publicTrip.tiers.heading')}
      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-6 mb-8"
    >
      <h2 className="text-base font-bold text-zinc-900 dark:text-white mb-1">{t('publicTrip.tiers.heading')}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">{t('publicTrip.tiers.subheading')}</p>

      {/* Participant count + progress toward the next tier */}
      <div className="mb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
          <span data-testid="tier-participant-count" className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-white">
            <Users size={14} className="text-zinc-400" />
            {t('publicTrip.tiers.participants', { count })}
          </span>
          <span data-testid="tier-next" className="text-xs text-zinc-500 dark:text-zinc-400">
            {next
              ? t('publicTrip.tiers.nextTier', { count: next.participants_needed, name: next.name })
              : t('publicTrip.tiers.allReached')}
          </span>
        </div>
        <div
          className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
        </div>
        {requiresPayment && (
          <p className="text-xs text-zinc-400 mt-2">{t('publicTrip.tiers.paidNote')}</p>
        )}
      </div>

      <ol className="flex flex-col gap-2">
        {tiers.map(tier => (
          <li
            key={tier.id}
            data-testid={`tier-${tier.id}`}
            data-active={tier.is_active || undefined}
            className={
              'flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ' +
              (tier.is_active
                ? 'border-zinc-900 dark:border-white bg-zinc-50 dark:bg-zinc-800/60'
                : tier.is_reached
                  ? 'border-zinc-200 dark:border-zinc-700'
                  : 'border-dashed border-zinc-200 dark:border-zinc-700 opacity-60')
            }
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{
                background: tier.is_active ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: tier.is_active ? 'var(--accent-text)' : 'var(--text-muted)',
              }}
            >
              {tier.is_active ? <BedDouble size={15} /> : tier.is_reached ? <Check size={14} /> : <Lock size={13} />}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">{tier.name}</span>
                {tier.is_active && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                    {t('publicTrip.tiers.active')}
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{rangeLabel(tier)}</div>
              {tier.place_name && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-1 min-w-0">
                  <MapPin size={11} className="flex-shrink-0" />
                  <span className="truncate">
                    {tier.place_name}{tier.place_address ? ` · ${tier.place_address}` : ''}
                  </span>
                </div>
              )}
              {tier.place_id && (safeUrl(tier.place_website) || mapsUrl(tier)) && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                  {safeUrl(tier.place_website) && (
                    <a
                      data-testid={`tier-website-${tier.id}`}
                      href={safeUrl(tier.place_website)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-zinc-900 dark:text-white underline underline-offset-2 hover:opacity-70"
                    >
                      <ExternalLink size={11} />
                      {t('publicTrip.tiers.viewPlace')}
                    </a>
                  )}
                  {mapsUrl(tier) && (
                    <a
                      data-testid={`tier-map-${tier.id}`}
                      href={mapsUrl(tier)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 underline underline-offset-2 hover:opacity-70"
                    >
                      <MapIcon size={11} />
                      {t('publicTrip.tiers.viewOnMap')}
                    </a>
                  )}
                </div>
              )}
              {tier.description && (
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 whitespace-pre-line">{tier.description}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
