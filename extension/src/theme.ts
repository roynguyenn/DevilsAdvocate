// Data-viz colors, validated for color-vision deficiency against the zinc-900 card surface (#18181b).
// Only these three hues are distinguishable when all pairs share the screen — fold anything else into neutrals.
export const CHART_COLORS = {
  spent: '#3987e5',
  purchase: '#d95926',
  savings: '#199e70',
  neutral: '#3f3f46', // zinc-700: budget remaining
  neutralStrong: '#71717a', // zinc-500: fixed bills
  surface: '#18181b', // zinc-900: 2px gap stroke between adjacent fills
} as const
