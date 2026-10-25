import { Check, Flame, Scale, TriangleAlert, type LucideIcon } from 'lucide-react'
import { type Intensity } from '../../settings'
import { usePopupStore } from '../store'

interface Level {
  id: Intensity
  name: string
  persona: string
  Icon: LucideIcon
  iconClass: string
  selectedClass: string
  description: string
}

const LEVELS: Level[] = [
  {
    id: 'light',
    name: 'Light',
    persona: 'The Gentle Nudge',
    Icon: TriangleAlert,
    iconClass: 'text-yellow-400',
    selectedClass: 'border-yellow-400/70 bg-yellow-400/10',
    description:
      'Intervenes only when necessary. Provides a quick budget reminder and a simple "Are you sure?" before the purchase goes through. Low friction.',
  },
  {
    id: 'medium',
    name: 'Medium',
    persona: 'The Negotiator',
    Icon: Scale,
    iconClass: 'text-amber-400',
    selectedClass: 'border-amber-500/70 bg-amber-500/10',
    description:
      'Weighs the purchase against your daily budget, suggests alternatives, and requires a brief rationalization before unlocking checkout.',
  },
  {
    id: 'harsh',
    name: 'Harsh',
    persona: 'The Interrogator',
    Icon: Flame,
    iconClass: 'text-red-400',
    selectedClass: 'border-red-500/70 bg-red-500/10',
    description:
      'Maximum friction. Aggressively challenges impulse buys, calls out missed savings goals, and demands a robust defense.',
  },
]

export default function InterventionCard() {
  const intensity = usePopupStore((s) => s.draft.intensity)
  const setIntensity = usePopupStore((s) => s.setIntensity)
  const selected = LEVELS.find((l) => l.id === intensity) ?? LEVELS[1]

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-panel p-4" aria-labelledby="intervention-title">
      <div>
        <h2 id="intervention-title" className="text-sm font-semibold text-zinc-100">Agent Intervention</h2>
        <p className="text-xs text-zinc-400">How hard should the Devil's Advocate push back?</p>
      </div>

      <div role="radiogroup" aria-labelledby="intervention-title" className="grid grid-cols-3 gap-2">
        {LEVELS.map(({ id, name, persona, Icon, iconClass, selectedClass }) => {
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
