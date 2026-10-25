// Data-viz colors, validated for color-vision deficiency against the panel surface (#1e1e1e).
// Only these three hues are distinguishable when all pairs share the screen — fold anything else into neutrals.
export const CHART_COLORS = {
  spent: '#3987e5',
  purchase: '#d95926',
  savings: '#199e70',
  neutral: '#3f3f46', // zinc-700: budget remaining
  neutralStrong: '#71717a', // zinc-500: fixed bills
  surface: '#1e1e1e', // `panel`: 2px gap stroke between adjacent fills
} as const

// Income split used by the overlay's Income & Allocation module and the popup's baseline editor.
export const ALLOCATION_COLORS = {
  fixedBills: CHART_COLORS.neutralStrong,
  savings: CHART_COLORS.savings,
  discretionary: CHART_COLORS.spent,
} as const
