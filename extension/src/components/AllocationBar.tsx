import { formatPercent, formatUsd } from '../format'

export interface AllocationSegment {
  key: string
  label: string
  value: number
  color: string
}

interface Props {
  segments: AllocationSegment[]
  total: number
  heightClass?: string
}

// Segment widths are data-driven, so they're inline styles rather than generated Tailwind classes;
// flex-shrink absorbs the 2px gaps so the segments never overflow. When the segments add up to more
// than `total`, the bar is scaled to their sum and the part beyond `total` is hatched over in red.
export default function AllocationBar({ segments, total, heightClass = 'h-2.5' }: Props) {
  const visible = segments.filter((s) => s.value > 0)
  const allocated = visible.reduce((sum, s) => sum + s.value, 0)
  const scale = Math.max(total, allocated)
  const over = Math.max(allocated - total, 0)

  return (
    <div
      role="img"
      aria-label={visible.map((s) => `${s.label} ${formatUsd(s.value)}`).join(', ') || 'Nothing allocated'}
      className={`relative flex w-full gap-0.5 overflow-hidden rounded-full bg-zinc-800 ${heightClass}`}
    >
      {scale > 0 &&
        visible.map((s) => (
          <div
            key={s.key}
            className="h-full min-w-0 transition-[width] duration-200 first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / scale) * 100}%`, backgroundColor: s.color }}
            title={`${s.label}: ${formatUsd(s.value)} (${formatPercent(s.value, total)})`}
          />
        ))}
      {over > 0 && (
        <div
          className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,rgba(239,68,68,0.9)_0_4px,rgba(239,68,68,0.45)_4px_8px)]"
          style={{ width: `${(over / scale) * 100}%` }}
          title={`Over-allocated by ${formatUsd(over)}`}
        />
      )}
    </div>
  )
}
