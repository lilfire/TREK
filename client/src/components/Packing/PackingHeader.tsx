import { useEffect, useRef } from 'react'
import { X, Check, CheckCheck, Luggage, Package, FolderPlus, Upload } from 'lucide-react'

interface Template {
  id: number
  name: string
  item_count: number
}

interface PackingHeaderProps {
  inlineHeader: boolean
  canEdit: boolean
  hasItems: boolean
  abgehakt: number
  totalCount: number
  fortschritt: number
  showSaveTemplate: boolean
  saveTemplateName: string
  setSaveTemplateName: (v: string) => void
  onSaveAsTemplate: () => void
  setShowSaveTemplate: (v: boolean) => void
  onOpenImport: () => void
  onClearChecked: () => void
  availableTemplates: Template[]
  showTemplateDropdown: boolean
  setShowTemplateDropdown: (v: boolean) => void
  applyingTemplate: boolean
  onApplyTemplate: (id: number) => void
  bagTrackingEnabled: boolean
  showBagModal: boolean
  setShowBagModal: (v: boolean) => void
  addingCategory: boolean
  setAddingCategory: (v: boolean) => void
  newCatName: string
  setNewCatName: (v: string) => void
  onAddNewCategory: () => void
  t: (key: string, params?: Record<string, string | number | null>) => string
}

export default function PackingHeader(props: PackingHeaderProps) {
  const {
    inlineHeader, canEdit, hasItems, abgehakt, totalCount, fortschritt,
    showSaveTemplate, saveTemplateName, setSaveTemplateName, onSaveAsTemplate, setShowSaveTemplate,
    onOpenImport, onClearChecked,
    availableTemplates, showTemplateDropdown, setShowTemplateDropdown, applyingTemplate, onApplyTemplate,
    bagTrackingEnabled, showBagModal, setShowBagModal,
    addingCategory, setAddingCategory, newCatName, setNewCatName, onAddNewCategory,
    t,
  } = props

  const templateDropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showTemplateDropdown) return
    const handler = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) setShowTemplateDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTemplateDropdown, setShowTemplateDropdown])

  return (
    <div style={{ padding: inlineHeader ? '20px 24px 16px' : '0 0 16px', flexShrink: 0, borderBottom: inlineHeader ? '1px solid rgba(0,0,0,0.06)' : undefined }}>
      <div style={{ display: 'flex', alignItems: inlineHeader ? 'flex-start' : 'center', justifyContent: 'space-between', gap: 14 }}>
        {inlineHeader ? (
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{t('packing.title')}</h2>
            {hasItems && (
              <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-faint)' }}>
                {t('packing.progress', { packed: abgehakt, total: totalCount, percent: fortschritt })}
              </p>
            )}
          </div>
        ) : <span />}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {canEdit && hasItems && showSaveTemplate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="text" autoFocus value={saveTemplateName}
                onChange={e => setSaveTemplateName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onSaveAsTemplate(); if (e.key === 'Escape') { setShowSaveTemplate(false); setSaveTemplateName('') } }}
                placeholder={t('packing.templateName')}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 99, border: '1px solid var(--border-primary)', outline: 'none', fontFamily: 'inherit', width: 140, background: 'var(--bg-card)', color: 'var(--text-primary)' }}
              />
              <button onClick={onSaveAsTemplate} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#10b981' }}><Check size={14} /></button>
              <button onClick={() => { setShowSaveTemplate(false); setSaveTemplateName('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-faint)' }}><X size={14} /></button>
            </div>
          )}
          {inlineHeader && canEdit && (
            <button onClick={onOpenImport} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 99, border: '1px solid var(--border-primary)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
              <Upload size={12} /> <span className="hidden sm:inline">{t('packing.import')}</span>
            </button>
          )}
          {inlineHeader && canEdit && abgehakt > 0 && (
            <button onClick={onClearChecked} style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 99, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit' }}>
              <span className="hidden sm:inline">{t('packing.clearChecked', { count: abgehakt })}</span>
              <span className="sm:hidden">{t('packing.clearCheckedShort', { count: abgehakt })}</span>
            </button>
          )}
          {inlineHeader && canEdit && availableTemplates.length > 0 && (
            <div ref={templateDropdownRef} style={{ position: 'relative' }}>
              <button onClick={() => setShowTemplateDropdown(!showTemplateDropdown)} disabled={applyingTemplate} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 99, border: '1px solid', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: showTemplateDropdown ? 'var(--text-primary)' : 'var(--bg-card)', borderColor: showTemplateDropdown ? 'var(--text-primary)' : 'var(--border-primary)', color: showTemplateDropdown ? 'var(--bg-primary)' : 'var(--text-muted)' }}>
                <Package size={12} /> <span className="hidden sm:inline">{t('packing.applyTemplate')}</span><span className="sm:hidden">{t('packing.template')}</span>
              </button>
              {showTemplateDropdown && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 4, minWidth: 200 }}>
                  {availableTemplates.map(tmpl => (
                    <button key={tmpl.id} onClick={() => onApplyTemplate(tmpl.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'transparent', fontFamily: 'inherit', fontSize: 12, color: 'var(--text-primary)', transition: 'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <Package size={13} style={{ color: 'var(--text-faint)' }} />
                      <div style={{ flex: 1, textAlign: 'left' }}>
                        <div style={{ fontWeight: 600 }}>{tmpl.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{tmpl.item_count} {t('admin.packingTemplates.items')}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {inlineHeader && canEdit && hasItems && !showSaveTemplate && (
            <button onClick={() => setShowSaveTemplate(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 99, border: '1px solid var(--border-primary)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
              <FolderPlus size={12} /> <span className="hidden sm:inline">{t('packing.saveAsTemplate')}</span>
            </button>
          )}
          {bagTrackingEnabled && (
            <button onClick={() => setShowBagModal(true)} className="xl:!hidden" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 99, border: '1px solid', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: showBagModal ? 'var(--text-primary)' : 'var(--bg-card)', borderColor: showBagModal ? 'var(--text-primary)' : 'var(--border-primary)', color: showBagModal ? 'var(--bg-primary)' : 'var(--text-muted)' }}>
              <Luggage size={12} /> {t('packing.bags')}
            </button>
          )}
        </div>
      </div>

      {hasItems && (
        <div className="hidden sm:block" style={{ marginTop: 14, marginBottom: 14 }}>
          <div className="flex items-center" style={{ gap: 14 }}>
            {fortschritt === 100 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700, color: '#10b981', letterSpacing: '-0.01em', flexShrink: 0 }}>
                <CheckCheck size={18} strokeWidth={2.5} />
                <span>{t('packing.allPacked')}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', lineHeight: 1 }}>{abgehakt}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums', lineHeight: 1, marginLeft: 1 }}>/{totalCount}</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: 'var(--bg-tertiary)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.4 }}>{fortschritt}%</span>
              </div>
            )}
            <div style={{ flex: 1, height: 8, background: 'var(--bg-tertiary)', borderRadius: 99, overflow: 'hidden', position: 'relative', width: '100%' }}>
              <div style={{ height: '100%', borderRadius: 99, transition: 'width 600ms cubic-bezier(0.23, 1, 0.32, 1), background 400ms ease, box-shadow 400ms ease', background: fortschritt === 100 ? 'linear-gradient(90deg, #10b981 0%, #34d399 100%)' : 'var(--accent)', width: `${fortschritt}%`, boxShadow: fortschritt === 100 ? '0 0 14px rgba(16,185,129,0.45)' : 'none', position: 'relative' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 55%)', borderRadius: 99, pointerEvents: 'none' }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {canEdit && (addingCategory ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input autoFocus type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onAddNewCategory(); if (e.key === 'Escape') { setAddingCategory(false); setNewCatName('') } }}
            placeholder={t('packing.newCategoryPlaceholder')}
            style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border-primary)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', color: 'var(--text-primary)' }}
          />
          <button onClick={onAddNewCategory} disabled={!newCatName.trim()}
            style={{ padding: '8px 12px', borderRadius: 10, border: 'none', background: newCatName.trim() ? 'var(--text-primary)' : 'var(--border-primary)', color: 'var(--bg-primary)', cursor: newCatName.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center' }}>
            <Check size={16} />
          </button>
          <button onClick={() => { setAddingCategory(false); setNewCatName('') }}
            style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-faint)' }}>
            <X size={16} />
          </button>
        </div>
      ) : (
        <button onClick={() => setAddingCategory(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '9px 14px', borderRadius: 10, border: '1px dashed var(--border-primary)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-faint)', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-muted)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.color = 'var(--text-faint)' }}>
          <FolderPlus size={14} /> {t('packing.addCategory')}
        </button>
      ))}
    </div>
  )
}
