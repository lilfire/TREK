import { useState, useMemo, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from '../../i18n'
import apiClient, { todoApi } from '../../api/client'
import {
  Flag, User, AlertCircle, Inbox, CheckCheck,
} from 'lucide-react'
import type { TodoItem } from '../../types'
import type { TodoMember, TodoCategoryAssignee } from './types'
import TodoItemRow from './TodoItemRow'
import TodoDetailPane from './TodoDetailPane'
import TodoNewTaskPane from './TodoNewTaskPane'
import TodoCategoryGroup from './TodoCategoryGroup'

type FilterType = 'all' | 'my' | 'overdue' | 'done' | string

export default function TodoListPanel({ tripId, items, addItemSignal = 0 }: { tripId: number; items: TodoItem[]; addItemSignal?: number }) {
  const { t } = useTranslation()

  // Defensive: empty array is valid and should render an empty list without crashing.
  const safeItems = Array.isArray(items) ? items : []

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const [filter, setFilter] = useState<FilterType>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [isAddingNew, setIsAddingNew] = useState(false)
  const lastHandledAddSignal = useRef(addItemSignal)

  useEffect(() => {
    if (addItemSignal !== lastHandledAddSignal.current && addItemSignal > 0) {
      setSelectedId(null)
      setIsAddingNew(true)
    }
    lastHandledAddSignal.current = addItemSignal
  }, [addItemSignal])

  const [sortByPrio, setSortByPrio] = useState(false)
  const [members, setMembers] = useState<TodoMember[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [categoryAssignees, setCategoryAssignees] = useState<Record<string, TodoCategoryAssignee[]>>({})

  useEffect(() => {
    apiClient.get(`/trips/${tripId}/members`).then(r => {
      const owner = r.data?.owner
      const mems = r.data?.members || []
      const all = owner ? [owner, ...mems] : mems
      setMembers(all)
      setCurrentUserId(r.data?.current_user_id || null)
    }).catch(() => { /* swallow */ })
  }, [tripId])

  useEffect(() => {
    todoApi.getCategoryAssignees(tripId).then(d => {
      setCategoryAssignees(d.assignees || {})
    }).catch(() => { /* swallow */ })
  }, [tripId])

  const categories = useMemo(() => {
    const cats = new Set<string>()
    safeItems.forEach(i => { if (i.category) cats.add(i.category) })
    return Array.from(cats).sort()
  }, [safeItems])

  const today = new Date().toISOString().split('T')[0]

  const filtered = useMemo(() => {
    let result: TodoItem[]
    if (filter === 'all') result = safeItems.filter(i => !i.checked)
    else if (filter === 'done') result = safeItems.filter(i => !!i.checked)
    else if (filter === 'my') result = safeItems.filter(i => !i.checked && i.assigned_user_id === currentUserId)
    else if (filter === 'overdue') result = safeItems.filter(i => !i.checked && i.due_date && i.due_date < today)
    else result = safeItems.filter(i => i.category === filter)
    if (sortByPrio) result = [...result].sort((a, b) => (a.priority || 99) - (b.priority || 99))
    return result
  }, [safeItems, filter, currentUserId, today, sortByPrio])

  const selectedItem = safeItems.find(i => i.id === selectedId) || null
  const totalCount = safeItems.length
  const doneCount = safeItems.filter(i => !!i.checked).length
  const overdueCount = safeItems.filter(i => !i.checked && i.due_date && i.due_date < today).length
  const myCount = currentUserId ? safeItems.filter(i => !i.checked && i.assigned_user_id === currentUserId).length : 0

  const catCount = (cat: string) => safeItems.filter(i => i.category === cat && !i.checked).length

  // Icon prop accepts lucide-react icons; React.ComponentType is too narrow against LucideIcon, so use any here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SidebarItem = ({ id, icon: Icon, label, count }: { id: string; icon: any; label: string; count: number }) => (
    <button onClick={() => setFilter(id as FilterType)}
      title={isMobile ? label : undefined}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'center' : 'flex-start',
        gap: isMobile ? 0 : 8, width: '100%', padding: isMobile ? '8px 0' : '7px 12px',
        border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
        background: filter === id ? 'var(--bg-hover)' : 'transparent',
        color: filter === id ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: filter === id ? 600 : 400, transition: 'all 0.1s',
        position: 'relative',
      }}
      onMouseEnter={e => { if (filter !== id) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { if (filter !== id) e.currentTarget.style.background = 'transparent' }}
    >
      <Icon size={isMobile ? 18 : 15} style={{ flexShrink: 0, opacity: 0.7 }} />
      {!isMobile && <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>}
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

  const filterTitle = (() => {
    if (filter === 'all') return t('todo.filter.all')
    if (filter === 'done') return t('todo.filter.done')
    if (filter === 'my') return t('todo.filter.my')
    if (filter === 'overdue') return t('todo.filter.overdue')
    return filter
  })()

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 180px)', minHeight: 400 }}>
      {/* Left Sidebar */}
      <div style={{
        width: isMobile ? 52 : 220, flexShrink: 0, borderRight: '1px solid var(--border-faint)',
        padding: isMobile ? '12px 6px' : '16px 12px 16px 0', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto',
        transition: 'width 0.2s',
      }}>
        {!isMobile && (
          <div style={{ margin: '0 0 12px', padding: '14px 14px 12px', borderRadius: 14, background: 'var(--bg-hover)', border: '1px solid var(--border-primary)', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1, letterSpacing: '-0.02em' }}>
                {totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0}%
              </span>
            </div>
            <div style={{ height: 4, background: 'var(--border-faint)', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ height: '100%', width: totalCount > 0 ? `${Math.round((doneCount / totalCount) * 100)}%` : '0%', background: '#22c55e', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              {doneCount} / {totalCount} {t('todo.completed')}
            </div>
          </div>
        )}

        {!isMobile && (
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', padding: '8px 12px 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('todo.sidebar.tasks')}
          </div>
        )}
        <SidebarItem id="all" icon={Inbox} label={t('todo.filter.all')} count={safeItems.filter(i => !i.checked).length} />
        <SidebarItem id="my" icon={User} label={t('todo.filter.my')} count={myCount} />
        <SidebarItem id="overdue" icon={AlertCircle} label={t('todo.filter.overdue')} count={overdueCount} />
        <SidebarItem id="done" icon={CheckCheck} label={t('todo.filter.done')} count={doneCount} />

        {!isMobile && (
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', padding: '16px 12px 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('todo.sidebar.sortBy')}
          </div>
        )}
        <button onClick={() => setSortByPrio(v => !v)}
          title={isMobile ? t('todo.priority') : undefined}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'center' : 'flex-start',
            gap: isMobile ? 0 : 8, width: '100%', padding: isMobile ? '8px 0' : '7px 12px',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
            background: sortByPrio ? '#f59e0b12' : 'transparent',
            color: sortByPrio ? '#f59e0b' : 'var(--text-secondary)',
            fontWeight: sortByPrio ? 600 : 400, transition: 'all 0.1s',
          }}
          onMouseEnter={e => { if (!sortByPrio) e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={e => { if (!sortByPrio) e.currentTarget.style.background = 'transparent' }}
        >
          <Flag size={isMobile ? 18 : 15} style={{ flexShrink: 0, opacity: 0.7 }} />
          {!isMobile && <span style={{ flex: 1, textAlign: 'left' }}>{t('todo.priority')}</span>}
        </button>

        <TodoCategoryGroup
          categories={categories}
          catCount={catCount}
          filter={filter}
          setFilter={setFilter}
          isMobile={isMobile}
          tripId={tripId}
        />
      </div>

      {/* Middle: Task List */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-faint)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {filterTitle}
            </h2>
            <span style={{ fontSize: 13, color: 'var(--text-faint)', background: 'var(--bg-hover)', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
              {filtered.length}
            </span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {filtered.length === 0 ? null : (
            filtered.map(item => {
              const isSelected = selectedId === item.id
              const categoryAssigneeCount = item.category
                ? (categoryAssignees[item.category]?.length || 0)
                : 0
              return (
                <TodoItemRow
                  key={item.id}
                  item={item}
                  tripId={tripId}
                  members={members}
                  categories={categories}
                  isSelected={isSelected}
                  todayIso={today}
                  assigneeCount={categoryAssigneeCount}
                  onClick={() => { setSelectedId(isSelected ? null : item.id); setIsAddingNew(false) }}
                />
              )
            })
          )}
        </div>
      </div>

      {/* Right: Detail Pane */}
      {selectedItem && !isAddingNew && !isMobile && (
        <TodoDetailPane
          item={selectedItem}
          tripId={tripId}
          categories={categories}
          members={members}
          onClose={() => setSelectedId(null)}
        />
      )}
      {selectedItem && !isAddingNew && isMobile && (
        <div onClick={e => { if (e.target === e.currentTarget) setSelectedId(null) }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', paddingBottom: 'var(--bottom-nav-h)' }}>
          <div style={{ width: '100%', maxHeight: '85vh', borderRadius: '16px 16px 0 0', overflow: 'auto' }}
            ref={el => { if (el) { const child = el.firstElementChild as HTMLElement | null; if (child) { child.style.width = '100%'; child.style.borderLeft = 'none'; child.style.borderRadius = '16px 16px 0 0' } } }}>
            <TodoDetailPane
              item={selectedItem}
              tripId={tripId}
              categories={categories}
              members={members}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>
      )}
      {isAddingNew && !selectedItem && !isMobile && ReactDOM.createPortal(
        <div onClick={e => { if (e.target === e.currentTarget) setIsAddingNew(false) }}
          className="modal-backdrop"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 'calc(var(--nav-h) + 60px)', paddingBottom: 40 }}>
          <div style={{ width: 'min(520px, 92vw)', maxHeight: 'calc(100vh - var(--nav-h) - 120px)', overflow: 'auto', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
            ref={el => { if (el) { const child = el.firstElementChild as HTMLElement | null; if (child) { child.style.width = '100%'; child.style.borderLeft = 'none'; child.style.borderRadius = '16px' } } }}>
            <TodoNewTaskPane
              tripId={tripId}
              categories={categories}
              members={members}
              defaultCategory={typeof filter === 'string' && categories.includes(filter) ? filter : null}
              onCreated={(id) => { setIsAddingNew(false); setSelectedId(id) }}
              onClose={() => setIsAddingNew(false)}
            />
          </div>
        </div>,
        document.body,
      )}
      {isAddingNew && !selectedItem && isMobile && ReactDOM.createPortal(
        <div onClick={e => { if (e.target === e.currentTarget) setIsAddingNew(false) }}
          className="modal-backdrop"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', paddingBottom: 'var(--bottom-nav-h)' }}>
          <div style={{ width: '100%', maxHeight: '85vh', borderRadius: '16px 16px 0 0', overflow: 'auto' }}
            ref={el => { if (el) { const child = el.firstElementChild as HTMLElement | null; if (child) { child.style.width = '100%'; child.style.borderLeft = 'none'; child.style.borderRadius = '16px 16px 0 0' } } }}>
            <TodoNewTaskPane
              tripId={tripId}
              categories={categories}
              members={members}
              defaultCategory={typeof filter === 'string' && categories.includes(filter) ? filter : null}
              onCreated={(id) => { setIsAddingNew(false); setSelectedId(id) }}
              onClose={() => setIsAddingNew(false)}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
