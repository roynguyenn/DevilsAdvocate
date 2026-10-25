import { formatUsd } from '../format'
import { useInterceptorStore } from '../store'
import { ALLOCATION_COLORS } from '../theme'
import AllocationBar from './AllocationBar'

export default function IncomeAllocation() {
  const income = useInterceptorStore((s) => s.monthlyIncome)
  const fixedBills = useInterceptorStore((s) => s.fixedBills)
  const savings = useInterceptorStore((s) => s.savings)
  const discretionary = useInterceptorStore((s) => s.totalBudget)

  const segments = [
    { key: 'bills', label: 'Fixed bills', value: fixedBills, color: ALLOCATION_COLORS.fixedBills },
    { key: 'savings', label: 'Savings', value: savings, color: ALLOCATION_COLORS.savings },
    { key: 'discretionary', label: 'Discretionary', value: discretionary, color: ALLOCATION_COLORS.discretionary },
  ]

  return (
    <section className="flex flex-col gap-3" aria-label="Income and allocation">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Income &amp; Allocation</h3>
        <p className="text-right">
          <span className="text-lg font-semibold tabular-nums text-zinc-100">{formatUsd(income)}</span>
          <span className="ml-1 text-xs text-zinc-400">/ mo</span>
        </p>
      </div>

      <AllocationBar segments={segments} total={income} />

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
