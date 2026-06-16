import { useState, useEffect } from 'react'
import { X, Flag, User, Trash2 } from 'lucide-react'
import { useTripStore } from '../../store/tripStore'
import { useCanDo } from '../../store/permissionsStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import CustomSelect from '../shared/CustomSelect'
import { CustomDatePicker } from '../shared/CustomDateTimePicker'
import type { TodoItem } from '../../types'
import type { TodoMember } from './types'
import { TODO_PRIO_CONFIG, todoKatColor } from './types'

interface DetailPaneProps {
  item: TodoItem
  tripId: number
  categories: string[]
  members: TodoMember[]
  onClose: () => void
}

export default function TodoDetailPane({ item, tripId, categories, members, onClose }: DetailPaneProps) {
  const { updateTodoItem, deleteTodoItem } = useTripStore()
  const trip = useTripStore(s => s.trip)
  const canEdit = useCanDo()('packing_edit', trip)
  const toast = useToast()
  const { t } = useTranslation()

  const [name, setName] = useState(item.name)
  const [desc, setDesc] = useState(item.description || '')
  const [dueDate, setDueDate] = useState(item.due_date || '')
  const [category, setCategory] = useState(item.category || '')
  const [assignedUserId, setAssignedUserId] = useState<number | null>(item.assigned_user_id)
  const [priority, setPriority] = useState(item.priority || 0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(item.name)
    setDesc(item.description || '')
    setDueDate(item.due_date || '')
    setCategory(item.category || '')
    setAssignedUserId(item.assigned_user_id)
    setPriority(item.priority || 0)
  }, [item.id, item.name, item.description, item.due_date, item.category, item.assigned_user_id, item.priority])

  const hasChanges = name !== item.name || desc !== (item.description || '') ||
    dueDate !== (item.due_date || '') || category !== (item.category || '') ||
    assignedUserId !== item.assigned_user_id || priority !== (item.priority || 0)

  const save = async () => {
    if (!name.trim() || !hasChanges) return
    setSaving(true)
    try {
      await updateTodoItem(tripId, item.id, {
        name: name.trim(), description: desc || null,
        due_date: dueDate || null, category: category || null,
        assigned_user_id: assignedUserId, priority,
      } as Record<string, unknown>)
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.error')) }
    setSaving(false)
  }

  const handleDelete = async () => {
    try {
      await deleteTodoItem(tripId, item.id)
      onClose()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.error')) }
  }

  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }
  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: 13, padding: '8px 10px', border: '1px solid var(--border-primary)',
    borderRadius: 8, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit',
  }

  return (
    <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid var(--border-faint)', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '1px solid var(--border-faint)' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('todo.detail.title')}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <input value={name} onChange={e => setName(e.target.value)} disabled={!canEdit}
            style={{ ...inputStyle, fontSize: 15, fontWeight: 600, border: 'none', padding: '4px 0', background: 'transparent' }}
            placeholder={t('todo.namePlaceholder')} />
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.description')}</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} disabled={!canEdit} rows={4}
            placeholder={t('todo.descriptionPlaceholder')}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} />
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.priority')}</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0, 1, 2, 3].map(p => {
              const cfg = TODO_PRIO_CONFIG[p]
              const isActive = priority === p
              return (
                <button key={p} onClick={() => canEdit && setPriority(p)}
                  style={{
                    flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: canEdit ? 'pointer' : 'default',
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
          <label style={labelStyle}>{t('todo.detail.category')}</label>
          <CustomSelect
            value={category}
            onChange={v => setCategory(v)}
            options={[
              { value: '', label: t('todo.noCategory') },
              ...categories.map(c => ({
                value: c, label: c,
                icon: <span style={{ width: 8, height: 8, borderRadius: '50%', background: todoKatColor(c, categories), display: 'inline-block' }} />,
              })),
            ]}
            placeholder={t('todo.noCategory')}
            size="sm"
            disabled={!canEdit}
          />
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
            disabled={!canEdit}
          />
        </div>
      </div>

      {canEdit && (
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-faint)', display: 'flex', gap: 8 }}>
          <button onClick={handleDelete}
            style={{
              flex: 1, padding: '9px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
            <Trash2 size={13} />
            {t('todo.detail.delete')}
          </button>
          <button onClick={save} disabled={!hasChanges || saving}
            style={{
              flex: 1, padding: '9px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: hasChanges ? 'pointer' : 'default', fontFamily: 'inherit',
              border: 'none', background: hasChanges ? 'var(--text-primary)' : 'var(--border-faint)',
              color: hasChanges ? 'var(--bg-primary)' : 'var(--text-faint)',
              transition: 'all 0.15s',
            }}>
            {saving ? '...' : t('todo.detail.save')}
          </button>
        </div>
      )}
    </div>
  )
}
