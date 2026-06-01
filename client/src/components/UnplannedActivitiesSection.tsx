import { MapPin, ChevronRight } from 'lucide-react'

interface Props {
  unplannedPlaces: any[]
  onSelect: (assignment: { place: any }) => void
  t: (key: string) => string
  locale: string
}

export default function UnplannedActivitiesSection({ unplannedPlaces, onSelect, t }: Props) {
  return (
    <section
      data-testid="unplanned-activities"
      aria-label={t('publicTrip.unplanned.heading')}
      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden mb-3"
    >
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
          {t('publicTrip.unplanned.heading')}
        </h2>
        <p className="text-xs text-zinc-400">
          {t('publicTrip.unplanned.subheading')}
        </p>
      </div>

      <div className="px-4 pb-3 flex flex-col gap-2 pt-2">
        {unplannedPlaces.map((place: any) => {
          const color = place.category_color || '#6366f1'
          return (
            <button
              key={place.id}
              type="button"
              data-testid={`unplanned-activity-${place.id}`}
              onClick={() => onSelect({ place })}
              className="flex items-center gap-3 w-full text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
                style={{ background: color }}
              >
                {place.image_url
                  ? <img src={place.image_url} alt="" className="w-full h-full object-cover" />
                  : <MapPin size={12} color="white" />
                }
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                  {place.name}
                </div>
                {(place.address || place.description) && (
                  <div className="text-xs text-zinc-400 truncate">
                    {place.address || place.description}
                  </div>
                )}
              </div>

              {place.category_name && (
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: color + '22', color }}
                >
                  {place.category_name}
                </span>
              )}

              <ChevronRight size={12} className="ml-auto flex-shrink-0 text-zinc-300" />
            </button>
          )
        })}
      </div>
    </section>
  )
}
