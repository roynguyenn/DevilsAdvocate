import { Check } from 'lucide-react'
import { INTENSITY_LEVELS, intensityLevel } from '../../intensity'
import { usePopupStore } from '../store'

export default function InterventionCard() {
  const intensity = usePopupStore((s) => s.draft.intensity)
  const setIntensity = usePopupStore((s) => s.setIntensity)
  const selected = intensityLevel(intensity)

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-panel p-4" aria-labelledby="intervention-title">
      <div>
        <h2 id="intervention-title" className="text-sm font-semibold text-zinc-100">Agent Intervention</h2>
        <p className="text-xs text-zinc-400">How hard should the Devil's Advocate push back?</p>
      </div>

      <div role="radiogroup" aria-labelledby="intervention-title" className="grid grid-cols-3 gap-2">
        {INTENSITY_LEVELS.map(({ id, name, persona, Icon, iconClass, selectedClass }) => {
          const isSelected = id === intensity
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setIntensity(id)}
              className={`relative flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-center transition-colors ${
                isSelected ? selectedClass : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/50'
              }`}
            >
              {/* Follows the choice. aria-hidden: the radio's aria-checked already announces it. */}
              {isSelected && (
                <span
                  aria-hidden
                  className="absolute -top-2 flex items-center gap-0.5 rounded-full border border-zinc-700 bg-panel py-px pl-1 pr-1.5 text-[10px] font-medium text-zinc-200"
                >
                  <Check className={`h-2.5 w-2.5 ${iconClass}`} strokeWidth={3} />
                  Selected
                </span>
              )}
              <Icon className={`h-5 w-5 ${iconClass}`} aria-hidden />
              <span className="text-sm font-semibold text-zinc-100">{name}</span>
              <span className="text-[11px] leading-tight text-zinc-400">{persona}</span>
            </button>
          )
        })}
      </div>

      <p className="rounded-lg bg-zinc-800/60 px-3 py-2.5 text-xs leading-relaxed text-zinc-300" aria-live="polite">
        <span className="font-semibold text-zinc-100">{selected.persona}: </span>
        {selected.description}
      </p>
    </section>
  )
}
