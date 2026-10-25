import { formatPercent, formatUsd } from '../format'
import { selectSavings, useInterceptorStore } from '../store'
import { CHART_COLORS } from '../theme'

export default function IncomeAllocation() {
  const income = useInterceptorStore((s) => s.monthlyIncome)
  const fixedBills = useInterceptorStore((s) => s.fixedBills)
  const discretionary = useInterceptorStore((s) => s.totalBudget)
  const savings = useInterceptorStore(selectSavings)

  const segments = [
    { key: 'bills', label: 'Fixed bills', value: fixedBills, color: CHART_COLORS.neutralStrong },
    { key: 'savings', label: 'Savings', value: savings, color: CHART_COLORS.savings },
    { key: 'discretionary', label: 'Discretionary', value: discretionary, color: CHART_COLORS.spent },
  ].filter((s) => s.value > 0)

  return (
    <section className="flex flex-col gap-3" aria-label="Income and allocation">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Income &amp; Allocation</h3>
        <p className="text-right">
          <span className="text-lg font-semibold tabular-nums text-zinc-100">{formatUsd(income)}</span>
          <span className="ml-1 text-xs text-zinc-400">/ mo</span>
        </p>
      </div>

      {/* Widths are data-driven, so they're inline styles rather than generated Tailwind classes;
          flex-shrink absorbs the 2px gaps so the segments never overflow. */}
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-zinc-800">
        {segments.map((s) => (
          <div
            key={s.key}
            className="h-full min-w-0 first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / income) * 100}%`, backgroundColor: s.color }}
            title={`${s.label}: ${formatUsd(s.value)} (${formatPercent(s.value, income)})`}
          />
        ))}
      </div>

      <ul className="grid grid-cols-3 gap-2 text-xs">
        {segments.map((s) => (
          <li key={s.key} className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="mt-0.5 pl-3.5 font-medium tabular-nums text-zinc-100">{formatUsd(s.value)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
