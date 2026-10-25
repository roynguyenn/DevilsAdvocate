import { useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from 'recharts'
import type { PieSectorShapeProps, TooltipContentProps, TooltipValueType } from 'recharts'
import { formatUsd, formatWholePercent, stackedPercents } from '../format'
import { useInterceptorStore } from '../store'
import { CHART_COLORS } from '../theme'
import FinancesPlaceholder from './FinancesPlaceholder'

type SliceKey = 'spent' | 'purchase' | 'remaining'

interface Slice {
  key: SliceKey
  label: string
  value: number
  // Of the budget, from stackedPercents so the legend, tooltip and centre always add up.
  percent: number | null
  color: string
}

const ACTIVE_GROW_PX = 6
const DIMMED_OPACITY = 0.3

type SliceTooltipProps = Pick<TooltipContentProps<TooltipValueType, string | number>, 'active' | 'payload'>

function SliceTooltip({ active, payload }: SliceTooltipProps) {
  const slice = payload?.[0]?.payload as Slice | undefined
  if (!active || !slice) return null
  return (
    <div className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs shadow-lg">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: slice.color }} />
      <span className="text-zinc-400">{slice.label}:</span>
      <span className="font-semibold tabular-nums text-zinc-100">{formatUsd(slice.value)}</span>
      <span className="tabular-nums text-zinc-400">({formatWholePercent(slice.percent)})</span>
    </div>
  )
}

export default function BudgetDonut() {
  const finances = useInterceptorStore((s) => s.finances)
  const price = useInterceptorStore((s) => s.cartTotal) ?? 0
  // Index into `visible`; drives the expanded slice, dimming of the others, and legend highlight.
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  if (!finances) return <FinancesPlaceholder className="h-44" />
  const { budget: totalBudget, spent } = finances

  const afterPurchase = spent + price
  const remaining = Math.max(totalBudget - afterPurchase, 0)
  const overBy = Math.max(afterPurchase - totalBudget, 0)

  // Spent + this purchase = the centre's "after purchase", and all three = 100% (more when over budget).
  const [spentPct, purchasePct, remainingPct] = stackedPercents([spent, price, remaining], totalBudget) ?? []
  const afterPct = spentPct === undefined || purchasePct === undefined ? null : spentPct + purchasePct

  // The purchase slice sits immediately after "spent" so it reads as the next chunk of the budget being eaten.
  const data: Slice[] = [
    { key: 'spent', label: 'Spent this month', value: spent, percent: spentPct ?? null, color: CHART_COLORS.spent },
    { key: 'purchase', label: 'This purchase', value: price, percent: purchasePct ?? null, color: CHART_COLORS.purchase },
    { key: 'remaining', label: 'Remaining', value: remaining, percent: remainingPct ?? null, color: CHART_COLORS.neutral },
  ]
  const visible = data.filter((d) => d.value > 0)

  const ActiveShape = ({ index, outerRadius = 0, isActive: _recharts, ...props }: PieSectorShapeProps) => {
    const isHovered = index === activeIndex
    const isDimmed = activeIndex !== null && !isHovered
    return (
      <Sector
        {...props}
        outerRadius={isHovered ? outerRadius + ACTIVE_GROW_PX : outerRadius}
        fillOpacity={isDimmed ? DIMMED_OPACITY : 1}
        style={{ transition: 'fill-opacity 150ms ease', cursor: 'pointer', outline: 'none' }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="relative h-44 w-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: ACTIVE_GROW_PX, right: ACTIVE_GROW_PX, bottom: ACTIVE_GROW_PX, left: ACTIVE_GROW_PX }}>
              <Pie
                data={visible}
                dataKey="value"
                nameKey="label"
                innerRadius="68%"
                outerRadius="92%"
                startAngle={90}
                endAngle={-270}
                cornerRadius={4}
                stroke={CHART_COLORS.surface}
                strokeWidth={2}
                animationBegin={0}
                animationDuration={500}
                shape={ActiveShape}
                onMouseEnter={(_, index) => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                {visible.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                content={(props) => <SliceTooltip {...props} />}
                cursor={false}
                isAnimationActive={false}
                wrapperStyle={{ zIndex: 10, outline: 'none' }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Fades out on hover so the tooltip, which can land over the hole, stays legible. */}
          <div
            className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center transition-opacity ${
              activeIndex === null ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className="text-2xl font-semibold tabular-nums text-zinc-100">
              {formatWholePercent(afterPct)}
            </span>
            <span className="text-[11px] text-zinc-400">after purchase</span>
          </div>
        </div>
  
        <ul className="flex w-full min-w-0 flex-1 flex-col gap-1 text-sm">
          {data.map((d) => {
            const index = visible.findIndex((v) => v.key === d.key)
            const isDimmed = activeIndex !== null && activeIndex !== index
            return (
              <li
                key={d.key}
                onMouseEnter={() => index >= 0 && setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                className={`flex flex-col gap-0.5 rounded-md px-2 py-1 transition-opacity ${
                  isDimmed ? 'opacity-40' : ''
                } ${activeIndex === index ? 'bg-zinc-800' : ''}`}
              >
                {/* Label on its own line so it's never truncated; the amount sits under it, aligned with the text. */}
                <span className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
                  {d.label}
                </span>
                <span className="pl-[1.125rem] font-medium tabular-nums text-zinc-100">
                  {formatUsd(d.value)}
                  <span className="ml-1.5 text-xs font-normal text-zinc-400">{formatWholePercent(d.percent)}</span>
                </span>
              </li>
            )
          })}
          <li className="mt-1 flex flex-col gap-0.5 border-t border-zinc-800 px-2 pt-2">
            <span className="pl-[1.125rem] text-xs text-zinc-400">Discretionary budget</span>
            <span className="pl-[1.125rem] font-medium tabular-nums text-zinc-100">{formatUsd(totalBudget)}</span>
          </li>
        </ul>
      </div>

      {overBy > 0 && (
        <p className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          This purchase puts you <span className="font-semibold">{formatUsd(overBy)}</span> over budget.
        </p>
      )}
    </div>
  )
}
