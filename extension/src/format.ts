export const formatUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export const formatPercent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'

// Whole percentages for parts shown side by side. Rounding each part on its own lets them disagree (23% + 12% next to
// a 36% total), so this rounds the running totals and takes differences: any run of adjacent parts adds up to the
// rounded percentage of their combined value, and parts that cover the whole add up to exactly 100%.
export function stackedPercents(parts: number[], whole: number): number[] | null {
  if (whole <= 0) return null
  let previous = 0
  let running = 0
  return parts.map((part) => {
    running += part
    const rounded = Math.round((running / whole) * 100)
    const percent = rounded - previous
    previous = rounded
    return percent
  })
}

export const formatWholePercent = (percent: number | null | undefined) => (percent == null ? '—' : `${percent}%`)

export function formatTimeAgo(timestamp: number, now = Date.now()) {
  const minutes = Math.max(Math.floor((now - timestamp) / 60_000), 0)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}
