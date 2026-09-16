import { useEffect, useState } from 'react'
import { BedDouble, Pencil, Plus, Trash2 } from 'lucide-react'
import { tripsApi, placesApi } from '../../api/client'
import CustomSelect from '../shared/CustomSelect'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import type { AccommodationTierStatus, AccommodationTierWithState } from '../../types'

interface Props {
  tripId: number
  currency: string
}

interface Draft {
  name: string
  min_participants: string
  place_id: string
  price_per_person: string
  description: string
}

const EMPTY_DRAFT: Draft = { name: '', min_participants: '', place_id: '', price_per_person: '', description: '' }

function apiErrorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
  return msg || fallback
}

/**
 * Manage accommodation tiers ("from N confirmed participants → accommodation X").
 * Changes are saved immediately, independent of the surrounding trip form.
 */
export default function AccommodationTierEditor({ tripId, currency }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const [status, setStatus] = useState<AccommodationTierStatus | null>(null)
  const [places, setPlaces] = useState<{ id: number; name: string }[]>([])
  // null = no form open, 'new' = adding, number = editing that tier
  const [editing, setEditing] = useState<'new' | number | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    tripsApi.listAccommodationTiers(tripId).then(setStatus).catch(() => {})
    placesApi.list(tripId).then(d => setPlaces(d.places || [])).catch(() => {})
  }, [tripId])

  const tiers = status?.tiers ?? []
  const activeTier = tiers.find(tier => tier.is_active)

  function openNew() {
    const highest = tiers[tiers.length - 1]
    setDraft({ ...EMPTY_DRAFT, min_participants: highest ? String(highest.min_participants + 1) : '1' })
    setFormError('')
    setEditing('new')
  }

  function openEdit(tier: AccommodationTierWithState) {
    setDraft({
      name: tier.name,
      min_participants: String(tier.min_participants),
      place_id: tier.place_id ? String(tier.place_id) : '',
      price_per_person: tier.price_per_person != null ? String(tier.price_per_person) : '',
      description: tier.description || '',
    })
    setFormError('')
    setEditing(tier.id)
  }

  async function handleSave() {
    const min = Number(draft.min_participants)
    if (!draft.name.trim()) { setFormError(t('tripForm.tiers.nameRequired')); return }
    if (!Number.isInteger(min) || min < 1) { setFormError(t('tripForm.tiers.minInvalid')); return }
    const price = draft.price_per_person.trim() ? Number(draft.price_per_person) : null
    if (price !== null && (isNaN(price) || price < 0)) { setFormError(t('tripForm.tiers.priceInvalid')); return }

    const payload = {
      name: draft.name.trim(),
      min_participants: min,
      place_id: draft.place_id ? Number(draft.place_id) : null,
      price_per_person: price,
      description: draft.description.trim() || null,
    }
    setSaving(true)
    setFormError('')
    try {
      const result = editing === 'new'
        ? await tripsApi.createAccommodationTier(tripId, payload)
        : await tripsApi.updateAccommodationTier(tripId, editing as number, payload)
      setStatus(result.status)
      setEditing(null)
    } catch (err) {
      setFormError(apiErrorMessage(err, t('tripForm.tiers.saveError')))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(tier: AccommodationTierWithState) {
    if (!window.confirm(t('tripForm.tiers.confirmDelete', { name: tier.name }))) return
    try {
      const result = await tripsApi.deleteAccommodationTier(tripId, tier.id)
      setStatus(result.status)
      if (editing === tier.id) setEditing(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('tripForm.tiers.deleteError')))
    }
  }

  // Enter inside tier fields must not submit the surrounding trip form. Enter in the
  // place picker only filters its option list, so it must not save the draft either --
  // the place the user is still searching for has not been applied yet.
  const blockEnter = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    const el = e.target as HTMLElement
    if (el.tagName === 'TEXTAREA') return
    e.preventDefault()
    if (el.closest('[data-tier-place-picker]')) return
    handleSave()
  }

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent text-sm'

  const placeOptions = [
    { value: '', label: t('tripForm.tiers.noPlace') },
    ...places.map(p => ({ value: String(p.id), label: p.name })),
  ]

  const rangeLabel = (tier: AccommodationTierWithState) =>
    tier.max_participants === null ? `${tier.min_participants}+`
      : tier.max_participants === tier.min_participants ? String(tier.min_participants)
        : `${tier.min_participants}–${tier.max_participants}`

  const form = (
    <div data-testid="tier-form" className="space-y-2 p-3 rounded-lg border border-slate-200 bg-slate-50" onKeyDown={blockEnter}>
      {formError && <p className="text-xs text-red-600">{formError}</p>}
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">{t('tripForm.tiers.name')}</label>
          <input data-testid="tier-name-input" type="text" maxLength={200} value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder={t('tripForm.tiers.namePlaceholder')} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">{t('tripForm.tiers.minParticipants')}</label>
          <input data-testid="tier-min-input" type="number" min={1} step={1} value={draft.min_participants}
            onChange={e => setDraft(d => ({ ...d, min_participants: e.target.value }))} className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2" data-tier-place-picker>
          <label className="block text-xs font-medium text-slate-600 mb-1">{t('tripForm.tiers.place')}</label>
          <CustomSelect value={draft.place_id} onChange={v => setDraft(d => ({ ...d, place_id: v }))}
            options={placeOptions} placeholder={t('tripForm.tiers.noPlace')} searchable size="sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">{t('tripForm.tiers.pricePerPerson', { currency })}</label>
          <input data-testid="tier-price-input" type="number" min={0} step="0.01" value={draft.price_per_person}
            onChange={e => setDraft(d => ({ ...d, price_per_person: e.target.value }))} className={inputCls} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">{t('tripForm.tiers.description')}</label>
        <textarea rows={2} maxLength={2000} value={draft.description}
          onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} className={`${inputCls} resize-none`} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(null)}
          className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50">
          {t('common.cancel')}
        </button>
        <button type="button" data-testid="tier-save" onClick={handleSave} disabled={saving}
          className="px-3 py-1.5 text-xs bg-slate-900 hover:bg-slate-700 disabled:bg-slate-400 text-white rounded-lg">
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  )

  return (
    <div data-testid="tier-editor">
      <label className="block text-sm font-medium text-slate-700 mb-1">
        <BedDouble className="inline w-4 h-4 mr-1" />{t('tripForm.tiers.heading')}
      </label>
      <p className="text-xs text-slate-500 mb-2">{t('tripForm.tiers.hint')}</p>

      {status && tiers.length > 0 && (
        <p data-testid="tier-editor-status" className="text-xs text-slate-600 mb-2">
          {t('tripForm.tiers.status', { count: status.participant_count })}
          {activeTier ? ` · ${t('tripForm.tiers.current', { name: activeTier.name })}` : ''}
        </p>
      )}

      <div className="space-y-2">
        {tiers.map(tier => editing === tier.id ? <div key={tier.id}>{form}</div> : (
          <div key={tier.id} data-testid={`tier-row-${tier.id}`}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${tier.is_active ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}>
            <span className="text-xs font-semibold text-slate-700 bg-slate-100 rounded px-2 py-0.5 shrink-0 tabular-nums">
              {rangeLabel(tier)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{tier.name}</div>
              {(tier.place_name || tier.price_per_person != null) && (
                <div className="text-xs text-slate-500 truncate">
                  {[tier.place_name, tier.price_per_person != null ? `${tier.price_per_person} ${currency}` : null].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
            <button type="button" onClick={() => openEdit(tier)} aria-label={t('common.edit')}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded">
              <Pencil size={14} />
            </button>
            <button type="button" onClick={() => handleDelete(tier)} aria-label={t('common.delete')}
              className="p-1.5 text-slate-400 hover:text-red-600 rounded">
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        {editing === 'new' ? form : (
          <button type="button" data-testid="tier-add" onClick={openNew}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 border border-dashed border-slate-300 rounded-lg hover:border-slate-400 hover:text-slate-800">
            <Plus size={13} /> {t('tripForm.tiers.add')}
          </button>
        )}
      </div>
    </div>
  )
}
