import { useState } from 'react'
import { X, Plus, Flag, User, Check } from 'lucide-react'
import { useTripStore } from '../../store/tripStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import CustomSelect from '../shared/CustomSelect'
import { CustomDatePicker } from '../shared/CustomDateTimePicker'
import type { TodoMember } from './types'
import { TODO_PRIO_CONFIG, todoKatColor } from './types'

interface NewTaskPaneProps {
  tripId: number
  categories: string[]
  members: TodoMember[]
  defaultCategory: string | null
  onCreated: (id: number) => void
  onClose: () => void
}

export default function TodoNewTaskPane({ tripId, categories, members, defaultCategory, onCreated, onClose }: NewTaskPaneProps) {
  const { addTodoItem } = useTripStore()
  const toast = useToast()
  const { t } = useTranslation()

  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [category, setCategory] = useState(defaultCategory || '')
  const [addingCategory, setAddingCategoryInline] = useState(false)
  const [assignedUserId, setAssignedUserId] = useState<number | null>(null)
  const [priority, setPriority] = useState(0)
  const [saving, setSaving] = useState(false)

  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }

  const create = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const trimmedCategory = category.trim()
      const item = await addTodoItem(tripId, {
        name: name.trim(), description: desc || null, priority,
        due_date: dueDate || null, category: trimmedCategory || null,
        assigned_user_id: assignedUserId,
      } as Record<string, unknown>)
      if (item?.id) onCreated(item.id)
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.error')) }
    setSaving(false)
  }

  return (
    <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid var(--border-faint)', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '1px solid var(--border-faint)' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('todo.newItem')}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) create() }}
            style={{ width: '100%', fontSize: 15, fontWeight: 600, border: 'none', padding: '4px 0', background: 'transparent', color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit' }}
            placeholder={t('todo.namePlaceholder')} />
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.description')}</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4}
            placeholder={t('todo.descriptionPlaceholder')}
            style={{ width: '100%', fontSize: 13, padding: '8px 10px', border: '1px solid var(--border-primary)', borderRadius: 8, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'vertical', minHeight: 80 }} />
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.category')}</label>
          {addingCategory ? (
            <div style={{ display: 'flex', gap: 4 }}>
              <input autoFocus value={category} onChange={e => setCategory(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setAddingCategoryInline(false); if (e.key === 'Escape') { setCategory(''); setAddingCategoryInline(false) } }}
                placeholder={t('todo.newCategory')}
                style={{ flex: 1, fontSize: 13, padding: '8px 10px', border: '1px solid var(--border-primary)', borderRadius: 8, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit', outline: 'none' }}
              />
              <button type="button" onClick={() => setAddingCategoryInline(false)}
                style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '0 10px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                <Check size={14} />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 4 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <CustomSelect
                  value={category}
                  onChange={v => setCategory(v)}
                  options={[
                    { value: '', label: t('todo.noCategory') },
                    ...categories.map(c => ({
                      value: c, label: c,
                      icon: <span style={{ width: 8, height: 8, borderRadius: '50%', background: todoKatColor(c, categories), display: 'inline-block' }} />,
                    })),
                    ...(category && !categories.includes(category) ? [{
                      value: category, label: `${category} (${t('todo.newCategoryLabel') || 'new'})`,
                      icon: <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9ca3af', display: 'inline-block' }} />,
                    }] : []),
                  ]}
                  placeholder={t('todo.noCategory')}
                  size="sm"
                />
              </div>
              <button type="button" onClick={() => { setCategory(''); setAddingCategoryInline(true) }}
                title={t('todo.newCategory')}
                style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '0 10px', cursor: 'pointer', color: 'var(--text-muted)', fontFamily: 'inherit' }}>
                <Plus size={14} />
              </button>
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.priority')}</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0, 1, 2, 3].map(p => {
              const cfg = TODO_PRIO_CONFIG[p]
              const isActive = priority === p
              return (
                <button key={p} onClick={() => setPriority(p)}
                  style={{
                    flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    border: `1px solid ${isActive && cfg ? cfg.color + '40' : 'var(--border-primary)'}`,
                    background: isActive && cfg ? cfg.color + '12' : 'transparent',
                    color: isActive && cfg ? cfg.color : isActive ? 'var(--text-primary)' : 'var(--text-faint)',
                    transition: 'all 0.1s',
                  }}>
                  {cfg ? <><Flag size={10} />{cfg.label}</> : t('todo.detail.noPriority')}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.dueDate')}</label>
          <CustomDatePicker value={dueDate} onChange={v => setDueDate(v)} />
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.assignedTo')}</label>
          <CustomSelect
            value={String(assignedUserId ?? '')}
            onChange={v => setAssignedUserId(v ? Number(v) : null)}
            options={[
              { value: '', label: t('todo.unassigned'), icon: <User size={14} style={{ color: 'var(--text-faint)' }} /> },
              ...members.map(m => ({
                value: String(m.id), label: m.username,
                icon: m.avatar ? (
                  <img src={`/uploads/avatars/${m.avatar}`} style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' as const }} alt="" />
                ) : (
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--border-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>
                    {m.username.charAt(0).toUpperCase()}
                  </span>
                ),
              })),
            ]}
            placeholder={t('todo.unassigned')}
            size="sm"
          />
        </div>
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-faint)' }}>
        <button onClick={create} disabled={!name.trim() || saving}
          style={{
            width: '100%', padding: '9px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: name.trim() ? 'pointer' : 'default', fontFamily: 'inherit',
            border: 'none', background: name.trim() ? 'var(--text-primary)' : 'var(--border-faint)',
            color: name.trim() ? 'var(--bg-primary)' : 'var(--text-faint)', transition: 'all 0.15s',
          }}>
          {saving ? '...' : t('todo.detail.create')}
        </button>
      </div>
    </div>
  )
}
