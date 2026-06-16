import { useState } from 'react'
import { Plus, Check } from 'lucide-react'
import { useCanDo } from '../../store/permissionsStore'
import { useToast } from '../shared/Toast'
import { useTripStore } from '../../store/tripStore'
import { useTranslation } from '../../i18n'
import { todoKatColor } from './types'

interface TodoCategoryGroupProps {
  categories: string[]
  catCount: (cat: string) => number
  filter: string
  setFilter: (f: string) => void
  isMobile: boolean
  tripId: number
}

export default function TodoCategoryGroup({ categories, catCount, filter, setFilter, isMobile, tripId }: TodoCategoryGroupProps) {
  const { addTodoItem } = useTripStore()
  const trip = useTripStore(s => s.trip)
  const canEdit = useCanDo()('packing_edit', trip)
  const toast = useToast()
  const { t } = useTranslation()

  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  const addCategory = () => {
    const name = newCategoryName.trim()
    if (!name || categories.includes(name)) { setAddingCategory(false); setNewCategoryName(''); return }
    addTodoItem(tripId, { name: t('todo.newItem'), category: name } as Record<string, unknown>)
      .then(() => { setAddingCategory(false); setNewCategoryName(''); setFilter(name) })
      .catch(err => toast.error(err instanceof Error ? err.message : t('common.error')))
  }

  const renderCatButton = (cat: string) => {
    const isActive = filter === cat
    const color = todoKatColor(cat, categories)
    const count = catCount(cat)
    return (
      <button
        key={cat}
        onClick={() => setFilter(cat)}
        title={isMobile ? cat : undefined}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'center' : 'flex-start',
          gap: isMobile ? 0 : 8, width: '100%', padding: isMobile ? '8px 0' : '7px 12px',
          border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
          background: isActive ? 'var(--bg-hover)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: isActive ? 600 : 400, transition: 'all 0.1s',
          position: 'relative',
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)' }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ width: isMobile ? 12 : 10, height: isMobile ? 12 : 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        {!isMobile && <span style={{ flex: 1, textAlign: 'left' }}>{cat}</span>}
        {!isMobile && count > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)', background: 'var(--bg-hover)', borderRadius: 10, padding: '1px 7px', minWidth: 20, textAlign: 'center' }}>
            {count}
          </span>
        )}
        {isMobile && count > 0 && (
          <span style={{ position: 'absolute', top: 2, right: 2, fontSize: 8, fontWeight: 700, color: 'var(--bg-primary)', background: 'var(--text-faint)', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {count}
          </span>
        )}
      </button>
    )
  }

  return (
    <>
      {!isMobile && (
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', padding: '16px 12px 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {t('todo.sidebar.categories')}
        </div>
      )}
      {isMobile && <div style={{ height: 1, background: 'var(--border-faint)', margin: '8px 4px' }} />}
      {categories.map(renderCatButton)}

      {canEdit && (
        addingCategory && !isMobile ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px' }}>
            <input autoFocus value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') { setAddingCategory(false); setNewCategoryName('') } }}
              placeholder={t('todo.newCategory')}
              style={{ flex: 1, fontSize: 12, padding: '4px 6px', border: '1px solid var(--border-primary)', borderRadius: 5, background: 'var(--bg-hover)', color: 'var(--text-primary)', fontFamily: 'inherit', minWidth: 0 }}
            />
            <button onClick={addCategory} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#22c55e', padding: 2 }}><Check size={13} /></button>
          </div>
        ) : (
          <button onClick={() => setAddingCategory(true)}
            title={isMobile ? t('todo.addCategory') : undefined}
            style={{ display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'center' : 'flex-start', gap: isMobile ? 0 : 6, padding: isMobile ? '8px 0' : '7px 12px', fontSize: 12, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left' }}
          >
            <Plus size={isMobile ? 18 : 13} /> {!isMobile && t('todo.addCategory')}
          </button>
        )
      )}
    </>
  )
}
