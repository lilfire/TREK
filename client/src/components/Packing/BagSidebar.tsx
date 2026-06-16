import { Plus } from 'lucide-react'
import BagCard from './BagCard'
import type { PackingItem } from '../../types'
import type { PackingBag, TripMember } from './types'

interface BagSidebarProps {
  bags: PackingBag[]
  items: PackingItem[]
  tripId: number
  tripMembers: TripMember[]
  canEdit: boolean
  onDeleteBag: (bagId: number) => void
  onUpdateBag: (bagId: number, data: Record<string, unknown>) => void
  onSetBagMembers: (bagId: number, userIds: number[]) => void
  onCreateBag: () => void
  showAddBag: boolean
  setShowAddBag: (v: boolean) => void
  newBagName: string
  setNewBagName: (v: string) => void
  t: (key: string, params?: Record<string, string | number | null>) => string
  variant: 'sidebar' | 'modal'
}

type WithBag = PackingItem & { bag_id?: number | null; weight_grams?: number | null }

export default function BagSidebar({
  bags, items, tripId, tripMembers, canEdit,
  onDeleteBag, onUpdateBag, onSetBagMembers,
  onCreateBag, showAddBag, setShowAddBag, newBagName, setNewBagName,
  t, variant,
}: BagSidebarProps) {
  const compact = variant === 'sidebar'
  const fmt = (g: number) => g >= 1000 ? `${(g / 1000).toFixed(1)} kg` : `${g} g`
  const totalAll = items.reduce((s, i) => s + ((i as WithBag).weight_grams || 0), 0)

  const unassigned = items.filter(i => !(i as WithBag).bag_id)
  const unassignedWeight = unassigned.reduce((s, i) => s + ((i as WithBag).weight_grams || 0), 0)

  return (
    <>
      {bags.map(bag => {
        const bagItems = items.filter(i => (i as WithBag).bag_id === bag.id)
        const totalWeight = bagItems.reduce((sum, i) => sum + ((i as WithBag).weight_grams || 0), 0)
        const maxBagWeight = bag.weight_limit_grams || Math.max(
          ...bags.map(b => items.filter(i => (i as WithBag).bag_id === b.id).reduce((s, i) => s + ((i as WithBag).weight_grams || 0), 0)),
          1,
        )
        const pct = Math.min(100, Math.round((totalWeight / maxBagWeight) * 100))
        return (
          <BagCard
            key={bag.id}
            bag={bag}
            bagItems={bagItems}
            totalWeight={totalWeight}
            pct={pct}
            tripId={tripId}
            tripMembers={tripMembers}
            canEdit={canEdit}
            onDelete={() => onDeleteBag(bag.id)}
            onUpdate={onUpdateBag}
            onSetMembers={onSetBagMembers}
            t={t}
            compact={compact}
          />
        )
      })}

      {unassigned.length > 0 && (
        <div style={{ marginBottom: compact ? 14 : 16, opacity: 0.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 6 : 8, marginBottom: compact ? 4 : 6 }}>
            <span style={{ width: compact ? 10 : 12, height: compact ? 10 : 12, borderRadius: '50%', border: '2px dashed var(--border-primary)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: compact ? 12 : 14, fontWeight: 600, color: 'var(--text-faint)' }}>{t('packing.noBag')}</span>
            <span style={{ fontSize: compact ? 11 : 13, color: 'var(--text-faint)' }}>{fmt(unassignedWeight)}</span>
          </div>
          <div style={{ fontSize: compact ? 10 : 11, color: 'var(--text-faint)' }}>
            {unassigned.length} {t('admin.packingTemplates.items')}
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-secondary)', paddingTop: compact ? 10 : 12, marginTop: compact ? 6 : 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: compact ? 12 : 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span>{t('packing.totalWeight')}</span>
          <span>{fmt(totalAll)}</span>
        </div>
      </div>

      {canEdit && (showAddBag ? (
        <div style={{ display: 'flex', gap: compact ? 4 : 6, marginTop: compact ? 12 : 14 }}>
          <input
            autoFocus
            value={newBagName}
            onChange={e => setNewBagName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onCreateBag(); if (e.key === 'Escape') { setShowAddBag(false); setNewBagName('') } }}
            placeholder={t('packing.bagName')}
            style={{ flex: 1, padding: compact ? '5px 8px' : '8px 12px', borderRadius: compact ? 8 : 10, border: '1px solid var(--border-primary)', fontSize: compact ? 11 : 13, fontFamily: 'inherit', outline: 'none' }}
          />
          <button
            onClick={onCreateBag}
            disabled={!newBagName.trim()}
            style={{ padding: compact ? '4px 8px' : '8px 12px', borderRadius: compact ? 8 : 10, border: 'none', background: newBagName.trim() ? 'var(--text-primary)' : 'var(--border-primary)', color: 'var(--bg-primary)', cursor: newBagName.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center' }}
          >
            <Plus size={compact ? 12 : 14} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddBag(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: compact ? 4 : 6,
            marginTop: compact ? 12 : 14,
            padding: compact ? '5px 8px' : '9px 14px',
            borderRadius: compact ? 8 : 10,
            border: '1px dashed var(--border-primary)', background: 'none', cursor: 'pointer',
            fontSize: compact ? 11 : 13, color: 'var(--text-faint)', fontFamily: 'inherit', width: '100%',
            transition: compact ? undefined : 'all 0.15s',
          }}
          onMouseEnter={compact ? undefined : (e => { e.currentTarget.style.borderColor = 'var(--text-muted)'; e.currentTarget.style.color = 'var(--text-secondary)' })}
          onMouseLeave={compact ? undefined : (e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.color = 'var(--text-faint)' })}
        >
          <Plus size={compact ? 11 : 14} /> {t('packing.addBag')}
        </button>
      ))}

    </>
  )
}
