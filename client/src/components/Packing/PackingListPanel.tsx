import { useState, useMemo, useRef, useEffect } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useCanDo } from '../../store/permissionsStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import { packingApi, tripsApi, adminApi } from '../../api/client'
import { X, Luggage } from 'lucide-react'
import type { PackingItem } from '../../types'
import type { PackingBag, TripMember, CategoryAssignee } from './types'
import KategorieGruppe from './KategorieGruppe'
import BagSidebar from './BagSidebar'
import BulkImportModal from './BulkImportModal'
import PackingHeader from './PackingHeader'

interface PackingListPanelProps {
  tripId: number
  items: PackingItem[]
  openImportSignal?: number
  clearCheckedSignal?: number
  saveTemplateSignal?: number
  inlineHeader?: boolean
}

export default function PackingListPanel({ tripId, items, openImportSignal = 0, clearCheckedSignal = 0, saveTemplateSignal = 0, inlineHeader = true }: PackingListPanelProps) {
  const [filter, setFilter] = useState('alle')
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const { addPackingItem, updatePackingItem, deletePackingItem } = useTripStore()
  const can = useCanDo()
  const trip = useTripStore(s => s.trip)
  const canEdit = can('packing_edit', trip)
  const toast = useToast()
  const { t } = useTranslation()

  // Defensive: empty array is valid and should render the empty state without crashing.
  const safeItems = Array.isArray(items) ? items : []

  const [tripMembers, setTripMembers] = useState<TripMember[]>([])
  const [categoryAssignees, setCategoryAssignees] = useState<Record<string, CategoryAssignee[]>>({})

  useEffect(() => {
    tripsApi.getMembers(tripId).then(data => {
      const all: TripMember[] = []
      if (data.owner) all.push({ id: data.owner.id, username: data.owner.username, avatar: data.owner.avatar_url })
      if (data.members) all.push(...data.members.map((m: { id: number; username: string; avatar_url?: string | null }) => ({ id: m.id, username: m.username, avatar: m.avatar_url })))
      setTripMembers(all)
    }).catch(() => { /* swallow */ })
    packingApi.getCategoryAssignees(tripId).then(data => {
      setCategoryAssignees(data.assignees || {})
    }).catch(() => { /* swallow */ })
  }, [tripId])

  const handleSetAssignees = async (category: string, userIds: number[]) => {
    try {
      const data = await packingApi.setCategoryAssignees(tripId, category, userIds)
      setCategoryAssignees(prev => ({ ...prev, [category]: data.assignees || [] }))
    } catch { toast.error(t('packing.toast.saveError')) }
  }

  const allCategories = useMemo(() => {
    const seen: string[] = []
    for (const item of safeItems) {
      const cat = item.category || t('packing.defaultCategory')
      if (!seen.includes(cat)) seen.push(cat)
    }
    return seen
  }, [safeItems, t])

  const gruppiert = useMemo(() => {
    const filtered = safeItems.filter(i => {
      if (filter === 'offen') return !i.checked
      if (filter === 'erledigt') return i.checked
      return true
    })
    const groups: Record<string, PackingItem[]> = {}
    for (const item of filtered) {
      const kat = item.category || t('packing.defaultCategory')
      if (!groups[kat]) groups[kat] = []
      groups[kat].push(item)
    }
    return groups
  }, [safeItems, filter, t])

  const abgehakt = safeItems.filter(i => i.checked).length
  const fortschritt = safeItems.length > 0 ? Math.round((abgehakt / safeItems.length) * 100) : 0

  const handleAddItemToCategory = async (category: string, name: string) => {
    try { await addPackingItem(tripId, { name, category }) }
    catch { toast.error(t('packing.toast.addError')) }
  }

  const handleAddNewCategory = async () => {
    if (!newCatName.trim()) return
    let catName = newCatName.trim()
    while (allCategories.includes(catName)) catName += '​'
    try {
      await addPackingItem(tripId, { name: '...', category: catName })
      setNewCatName(''); setAddingCategory(false)
    } catch { toast.error(t('packing.toast.addError')) }
  }

  const handleRenameCategory = async (oldName: string, newName: string) => {
    const toUpdate = safeItems.filter(i => (i.category || t('packing.defaultCategory')) === oldName)
    for (const item of toUpdate) await updatePackingItem(tripId, item.id, { category: newName })
  }

  const handleDeleteCategory = async (catItems: PackingItem[]) => {
    for (const item of catItems) {
      try { await deletePackingItem(tripId, item.id) } catch { /* swallow */ }
    }
  }

  const handleClearChecked = async () => {
    if (!confirm(t('packing.confirm.clearChecked', { count: abgehakt }))) return
    for (const item of safeItems.filter(i => i.checked)) {
      try { await deletePackingItem(tripId, item.id) } catch { /* swallow */ }
    }
  }

  // Bag tracking
  const [bagTrackingEnabled, setBagTrackingEnabled] = useState(false)
  const [bags, setBags] = useState<PackingBag[]>([])
  const [newBagName, setNewBagName] = useState('')
  const [showAddBag, setShowAddBag] = useState(false)
  const [showBagModal, setShowBagModal] = useState(false)

  useEffect(() => {
    adminApi.getBagTracking().then(d => {
      setBagTrackingEnabled(d.enabled)
      if (d.enabled) packingApi.listBags(tripId).then(r => setBags(r.bags || [])).catch(() => { /* swallow */ })
    }).catch(() => { /* swallow */ })
  }, [tripId])

  const BAG_COLORS = ['#6366f1', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#f59e0b']

  const handleCreateBag = async () => {
    if (!newBagName.trim()) return
    try {
      const data = await packingApi.createBag(tripId, { name: newBagName.trim(), color: BAG_COLORS[bags.length % BAG_COLORS.length] })
      setBags(prev => [...prev, data.bag])
      setNewBagName(''); setShowAddBag(false)
    } catch { toast.error(t('packing.toast.saveError')) }
  }

  const handleCreateBagByName = async (name: string): Promise<PackingBag | undefined> => {
    try {
      const data = await packingApi.createBag(tripId, { name, color: BAG_COLORS[bags.length % BAG_COLORS.length] })
      setBags(prev => [...prev, data.bag])
      return data.bag
    } catch { toast.error(t('packing.toast.saveError')); return undefined }
  }

  const handleDeleteBag = async (bagId: number) => {
    try {
      await packingApi.deleteBag(tripId, bagId)
      setBags(prev => prev.filter(b => b.id !== bagId))
    } catch { toast.error(t('packing.toast.deleteError')) }
  }

  const handleUpdateBag = async (bagId: number, data: Record<string, unknown>) => {
    try {
      const result = await packingApi.updateBag(tripId, bagId, data)
      setBags(prev => prev.map(b => b.id === bagId ? { ...b, ...result.bag } : b))
    } catch { toast.error(t('common.error')) }
  }

  const handleSetBagMembers = async (bagId: number, userIds: number[]) => {
    try {
      const result = await packingApi.setBagMembers(tripId, bagId, userIds)
      setBags(prev => prev.map(b => b.id === bagId ? { ...b, members: result.members } : b))
    } catch { toast.error(t('common.error')) }
  }

  // Templates
  const [availableTemplates, setAvailableTemplates] = useState<{ id: number; name: string; item_count: number }[]>([])
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false)
  const [applyingTemplate, setApplyingTemplate] = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [importText, setImportText] = useState('')
  const lastHandledImportSignal = useRef(openImportSignal)
  const lastHandledClearSignal = useRef(clearCheckedSignal)
  const lastHandledSaveSignal = useRef(saveTemplateSignal)

  useEffect(() => {
    if (openImportSignal !== lastHandledImportSignal.current && openImportSignal > 0) setShowImportModal(true)
    lastHandledImportSignal.current = openImportSignal
  }, [openImportSignal])

  useEffect(() => {
    if (clearCheckedSignal !== lastHandledClearSignal.current && clearCheckedSignal > 0) handleClearChecked()
    lastHandledClearSignal.current = clearCheckedSignal
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearCheckedSignal])

  useEffect(() => {
    if (saveTemplateSignal !== lastHandledSaveSignal.current && saveTemplateSignal > 0) setShowSaveTemplate(true)
    lastHandledSaveSignal.current = saveTemplateSignal
  }, [saveTemplateSignal])

  useEffect(() => {
    adminApi.packingTemplates().then(d => setAvailableTemplates(d.templates || [])).catch(() => { /* swallow */ })
  }, [tripId])

  const handleApplyTemplate = async (templateId: number) => {
    setApplyingTemplate(true)
    try {
      const data = await packingApi.applyTemplate(tripId, templateId)
      useTripStore.setState(s => ({ packingItems: [...s.packingItems, ...(data.items || [])] }))
      toast.success(t('packing.templateApplied', { count: data.count }))
      setShowTemplateDropdown(false)
    } catch { toast.error(t('packing.templateError')) }
    finally { setApplyingTemplate(false) }
  }

  const handleSaveAsTemplate = async () => {
    if (!saveTemplateName.trim()) return
    try {
      await packingApi.saveAsTemplate(tripId, saveTemplateName.trim())
      toast.success(t('packing.templateSaved'))
      setShowSaveTemplate(false); setSaveTemplateName('')
      adminApi.packingTemplates().then(d => setAvailableTemplates(d.templates || [])).catch(() => { /* swallow */ })
    } catch { toast.error(t('common.error')) }
  }

  const parseCsvLine = (line: string): string[] => {
    const parts: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) { parts.push(current.trim()); current = ''; continue }
      current += ch
    }
    parts.push(current.trim())
    return parts
  }

  const parseImportLines = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const parts = parseCsvLine(line)
    if (parts.length >= 2) {
      const category = parts[0]
      const name = parts[1]
      const weight_grams = parts[2] || undefined
      const bag = parts[3] || undefined
      const checked = parts[4]?.toLowerCase() === 'checked' || parts[4] === '1'
      return { name, category, weight_grams, bag, checked }
    }
    return { name: parts[0], category: undefined, weight_grams: undefined, bag: undefined, checked: false }
  }).filter(i => i.name)

  const handleBulkImport = async () => {
    const parsed = parseImportLines(importText)
    if (parsed.length === 0) { toast.error(t('packing.importEmpty')); return }
    try {
      const result = await packingApi.bulkImport(tripId, parsed)
      useTripStore.setState(s => ({ packingItems: [...s.packingItems, ...(result.items || [])] }))
      toast.success(t('packing.importSuccess', { count: result.count }))
      setImportText(''); setShowImportModal(false)
    } catch { toast.error(t('packing.importError')) }
  }

  const font = { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }
  const hasItems = safeItems.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', ...font }}>
      <PackingHeader
        inlineHeader={inlineHeader}
        canEdit={canEdit}
        hasItems={hasItems}
        abgehakt={abgehakt}
        totalCount={safeItems.length}
        fortschritt={fortschritt}
        showSaveTemplate={showSaveTemplate}
        saveTemplateName={saveTemplateName}
        setSaveTemplateName={setSaveTemplateName}
        onSaveAsTemplate={handleSaveAsTemplate}
        setShowSaveTemplate={setShowSaveTemplate}
        onOpenImport={() => setShowImportModal(true)}
        onClearChecked={handleClearChecked}
        availableTemplates={availableTemplates}
        showTemplateDropdown={showTemplateDropdown}
        setShowTemplateDropdown={setShowTemplateDropdown}
        applyingTemplate={applyingTemplate}
        onApplyTemplate={handleApplyTemplate}
        bagTrackingEnabled={bagTrackingEnabled}
        showBagModal={showBagModal}
        setShowBagModal={setShowBagModal}
        addingCategory={addingCategory}
        setAddingCategory={setAddingCategory}
        newCatName={newCatName}
        setNewCatName={setNewCatName}
        onAddNewCategory={handleAddNewCategory}
        t={t}
      />

      {/* Filter tabs */}
      {hasItems && (
        <div style={{ display: 'flex', gap: 4, padding: '10px 0 0', flexShrink: 0 }}>
          {[['alle', t('packing.filterAll')], ['offen', t('packing.filterOpen')], ['erledigt', t('packing.filterDone')]].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} style={{ padding: '4px 12px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: filter === id ? 600 : 400, background: filter === id ? 'var(--text-primary)' : 'transparent', color: filter === id ? 'var(--bg-primary)' : 'var(--text-muted)' }}>{label}</button>
          ))}
        </div>
      )}

      {/* List + bag sidebar */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0 16px' }}>
          {!hasItems ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <Luggage size={40} style={{ color: 'var(--text-faint)', display: 'block', margin: '0 auto 10px' }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 4px' }}>{t('packing.emptyTitle')}</p>
              <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>{t('packing.emptyHint')}</p>
            </div>
          ) : Object.keys(gruppiert).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-faint)' }}>
              <p style={{ fontSize: 13, margin: 0 }}>{t('packing.emptyFiltered')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {Object.entries(gruppiert).map(([kat, katItems]) => (
                <KategorieGruppe
                  key={kat}
                  kategorie={kat}
                  items={katItems}
                  tripId={tripId}
                  allCategories={allCategories}
                  onRename={handleRenameCategory}
                  onDeleteAll={handleDeleteCategory}
                  onAddItem={handleAddItemToCategory}
                  assignees={categoryAssignees[kat] || []}
                  tripMembers={tripMembers}
                  onSetAssignees={handleSetAssignees}
                  bagTrackingEnabled={bagTrackingEnabled}
                  bags={bags}
                  onCreateBag={handleCreateBagByName}
                  canEdit={canEdit}
                />
              ))}
            </div>
          )}
        </div>

        {bagTrackingEnabled && bags.length > 0 && (
          <div className="hidden xl:block" style={{ width: 260, borderLeft: '1px solid var(--border-secondary)', overflowY: 'auto', padding: 16, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 12 }}>
              {t('packing.bags')}
            </div>
            <BagSidebar
              bags={bags}
              items={safeItems}
              tripId={tripId}
              tripMembers={tripMembers}
              canEdit={canEdit}
              onDeleteBag={handleDeleteBag}
              onUpdateBag={handleUpdateBag}
              onSetBagMembers={handleSetBagMembers}
              onCreateBag={handleCreateBag}
              showAddBag={showAddBag}
              setShowAddBag={setShowAddBag}
              newBagName={newBagName}
              setNewBagName={setNewBagName}
              t={t}
              variant="sidebar"
            />
          </div>
        )}
      </div>

      {/* Bag modal (mobile/click) */}
      {showBagModal && bagTrackingEnabled && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, paddingTop: 140, paddingBottom: 'calc(20px + var(--bottom-nav-h))', overflowY: 'auto' }} onClick={() => setShowBagModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 360, maxHeight: 'calc(100vh - 80px)', overflow: 'auto', padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.15)', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{t('packing.bags')}</h3>
              <button onClick={() => setShowBagModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex' }}><X size={18} /></button>
            </div>
            <BagSidebar
              bags={bags}
              items={safeItems}
              tripId={tripId}
              tripMembers={tripMembers}
              canEdit={canEdit}
              onDeleteBag={handleDeleteBag}
              onUpdateBag={handleUpdateBag}
              onSetBagMembers={handleSetBagMembers}
              onCreateBag={handleCreateBag}
              showAddBag={showAddBag}
              setShowAddBag={setShowAddBag}
              newBagName={newBagName}
              setNewBagName={setNewBagName}
              t={t}
              variant="modal"
            />
          </div>
        </div>
      )}

      <style>{`
        .assignee-chip:hover + .assignee-tooltip { opacity: 1 !important; }
        .assignee-chip:hover { opacity: 0.7; }
      `}</style>

      <BulkImportModal
        open={showImportModal}
        importText={importText}
        setImportText={setImportText}
        parsedCount={parseImportLines(importText).length}
        onClose={() => setShowImportModal(false)}
        onImport={handleBulkImport}
        t={t}
      />
    </div>
  )
}
