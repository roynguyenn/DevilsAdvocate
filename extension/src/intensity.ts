import { Flame, Scale, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { Intensity } from './settings'

// The three Agent Intervention modes, as the popup's selector and the overlay's chat badge show them.
export interface IntensityLevel {
  id: Intensity
  name: string
  persona: string
  Icon: LucideIcon
  iconClass: string
  selectedClass: string
  // Chat panel badge: <color>-500/10 fill, <color>-300 text, matching ring.
  badgeClass: string
  description: string
}

export const INTENSITY_LEVELS: IntensityLevel[] = [
  {
    id: 'light',
    name: 'Light',
    persona: 'The Gentle Nudge',
    Icon: TriangleAlert,
    iconClass: 'text-yellow-400',
    selectedClass: 'border-yellow-400/70 bg-yellow-400/10',
    badgeClass: 'bg-yellow-500/10 text-yellow-300 ring-yellow-500/40',
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
    badgeClass: 'bg-amber-500/10 text-amber-300 ring-amber-500/40',
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
    badgeClass: 'bg-red-500/10 text-red-300 ring-red-500/40',
    description:
      'Maximum friction. Aggressively challenges impulse buys, calls out missed savings goals, and demands a robust defense.',
  },
]

export const intensityLevel = (id: Intensity) => INTENSITY_LEVELS.find((l) => l.id === id) ?? INTENSITY_LEVELS[1]
