import { MapPin, Clock, FileText, ExternalLink, Phone, X } from 'lucide-react'

function mimeAbbr(mimeType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WEBP',
    'video/mp4': 'MP4',
    'video/quicktime': 'MOV',
    'application/zip': 'ZIP',
  }
  return map[mimeType] || mimeType.split('/')[1]?.toUpperCase().slice(0, 4) || 'FILE'
}

function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null) return null
  if (bytes < 1024) return '< 1 KB'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}min`
  if (mins === 0) return `${hours}hr`
  return `${hours}hr ${mins}min`
}

function truncateText(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text
  const slice = text.slice(0, maxLen)
  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + '…'
}

interface Props {
  assignment: any
  tripCurrency: string
  budgetItems?: any[]
  onClose: () => void
}

export default function PublicActivityModal({ assignment, tripCurrency, budgetItems, onClose }: Props) {
  const place = assignment.place
  const files: any[] = place.files || []
  const budgetMatchKey = place.budget_category || place.name
  const placeBudgetItems = (budgetItems || []).filter((item: any) => item.category === budgetMatchKey)

  return (
    <div
      data-testid="activity-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-zinc-100 dark:border-zinc-800">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: place.category?.color || '#6366f1' }}
          >
            {place.image_url
              ? <img src={place.image_url} alt="" className="w-full h-full object-cover rounded-xl" />
              : <MapPin size={14} color="white" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-zinc-900 dark:text-white leading-tight">
              {place.name}
            </h3>
            {place.category && (
              <span className="text-xs text-zinc-400">{place.category.name}</span>
            )}
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {place.description && (
            <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {truncateText(place.description)}
            </p>
          )}

          {place.notes && (
            <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-sm text-zinc-600 dark:text-zinc-300">
              {truncateText(place.notes)}
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {place.address && (
              <div className="flex items-start gap-2.5 text-sm">
                <MapPin size={14} className="flex-shrink-0 mt-0.5 text-zinc-400" />
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.address)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                >
                  {place.address}
                </a>
              </div>
            )}

            {(place.place_time || place.end_time) && (
              <div className="flex items-center gap-2.5 text-sm">
                <Clock size={14} className="flex-shrink-0 text-zinc-400" />
                <span className="text-zinc-600 dark:text-zinc-300">
                  {place.place_time}
                  {place.end_time
                    ? ` – ${place.end_time}`
                    : place.duration_minutes
                      ? ` (${formatDuration(place.duration_minutes)})`
                      : ''}
                </span>
              </div>
            )}

            {place.website && (
              <div className="flex items-center gap-2.5 text-sm">
                <ExternalLink size={14} className="flex-shrink-0 text-zinc-400" />
                <a
                  href={place.website}
                  target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 hover:underline truncate"
                >
                  {place.website.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}

            {place.phone && (
              <div className="flex items-center gap-2.5 text-sm">
                <Phone size={14} className="flex-shrink-0 text-zinc-400" />
                <a href={`tel:${place.phone}`} className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900">
                  {place.phone}
                </a>
              </div>
            )}

            {(place.price != null && place.price > 0) && (
              <div className="flex items-center gap-2.5 text-sm">
                <span className="text-zinc-400 text-xs font-mono w-3.5 text-center flex-shrink-0">$</span>
                <span className="text-zinc-600 dark:text-zinc-300">
                  {Number(place.price).toLocaleString()} {place.currency || tripCurrency || 'NOK'}
                </span>
              </div>
            )}
          </div>

          {/* Per-place budget items filtered by category matching place name */}
          {placeBudgetItems.length > 0 && (
            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Budget
              </p>
              <div className="flex flex-col gap-1.5">
                {placeBudgetItems.map((item: any) => (
                  <div
                    key={item.id}
                    data-testid="modal-budget-item"
                    className="flex items-center gap-2.5 text-sm"
                  >
                    <span className="text-zinc-400 text-xs font-mono w-3.5 text-center flex-shrink-0">$</span>
                    <span className="flex-1 text-zinc-600 dark:text-zinc-300">{item.title}</span>
                    <span className="text-zinc-600 dark:text-zinc-300 font-medium tabular-nums">
                      {Number(item.amount).toLocaleString()} {tripCurrency}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files — clickable downloads/thumbnails when URL is available */}
          {files.length > 0 && (
            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Files ({files.length})
              </p>
              <div className="flex flex-col gap-1.5">
                {files.map((f: any) => {
                  const size = formatFileSize(f.file_size)
                  const isImage = f.mime_type?.startsWith('image/')

                  if (f.url) {
                    return (
                      <a
                        key={f.id}
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 text-sm text-zinc-600 dark:text-zinc-300 py-1 hover:text-zinc-900 dark:hover:text-white"
                      >
                        {isImage
                          ? <img
                              src={f.url}
                              alt={f.original_name}
                              className="w-8 h-8 object-cover rounded flex-shrink-0"
                            />
                          : <FileText size={13} className="flex-shrink-0 text-zinc-400" />
                        }
                        <span className="truncate flex-1">{f.original_name}</span>
                        <span className="ml-auto text-xs text-zinc-400 flex-shrink-0">
                          {mimeAbbr(f.mime_type || '')}{size ? `, ${size}` : ''}
                        </span>
                      </a>
                    )
                  }

                  return (
                    <div key={f.id} className="flex items-center gap-2.5 text-sm text-zinc-600 dark:text-zinc-300 py-1">
                      <FileText size={13} className="flex-shrink-0 text-zinc-400" />
                      <span className="truncate flex-1">{f.original_name}</span>
                      <span className="ml-auto text-xs text-zinc-400 flex-shrink-0">
                        {mimeAbbr(f.mime_type || '')}{size ? `, ${size}` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
