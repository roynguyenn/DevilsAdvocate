import type { CSSProperties } from 'react'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import AllocationBar from '../../components/AllocationBar'
import { formatPercent, formatUsd } from '../../format'
import { ALLOCATION_COLORS } from '../../theme'
import { selectAllocation, usePopupStore } from '../store'
import CurrencyInput from './CurrencyInput'

interface RowProps {
  id: string
  label: string
  hint: string
  color: string
  value: number
  income: number
  onChange: (value: number) => void
}

function AllocationRow({ id, label, hint, color, value, income, onChange }: RowProps) {
  const fillPercent = income > 0 ? Math.min((value / income) * 100, 100) : 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
            {label}
            <span className="text-xs font-normal tabular-nums text-zinc-400">{formatPercent(value, income)}</span>
          </span>
          <span className="block pl-[1.125rem] text-[11px] text-zinc-400">{hint}</span>
        </label>
        <CurrencyInput id={id} value={value} onChange={onChange} ariaLabel={label} className="w-28 px-2.5 py-1.5 text-right text-sm" />
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(income, 0)}
        step={1}
        value={Math.min(value, income)}
        disabled={income <= 0}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} slider`}
        // Custom-drawn: native range tracks pick their own (light) color for gray accents.
        style={{ background: `linear-gradient(to right, ${color} ${fillPercent}%, #3f3f46 ${fillPercent}%)`, '--thumb': color } as CSSProperties}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-zinc-100 [&::-webkit-slider-thumb]:bg-[var(--thumb)] [&::-webkit-slider-thumb]:shadow"
      />
    </div>
  )
}

export default function BaselineCard() {
  const draft = usePopupStore((s) => s.draft)
  const { overBy, unallocated, isBalanced } = usePopupStore(useShallow(selectAllocation))
  const setIncome = usePopupStore((s) => s.setIncome)
  const setFixedBills = usePopupStore((s) => s.setFixedBills)
  const setSavings = usePopupStore((s) => s.setSavings)
  const setDiscretionary = usePopupStore((s) => s.setDiscretionary)
  const income = draft.monthlyIncome

  const segments = [
    { key: 'bills', label: 'Fixed bills', value: draft.fixedBills, color: ALLOCATION_COLORS.fixedBills },
    { key: 'savings', label: 'Savings', value: draft.savings, color: ALLOCATION_COLORS.savings },
    { key: 'discretionary', label: 'Discretionary', value: draft.discretionary, color: ALLOCATION_COLORS.discretionary },
  ]

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-panel p-4" aria-label="Financial baseline and allocation">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="income" className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Monthly net income
        </label>
        <CurrencyInput
          id="income"
          value={income}
          onChange={setIncome}
          ariaLabel="Monthly net income"
          className="w-full px-3 py-2 text-2xl font-semibold"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <AllocationBar segments={segments} total={income} heightClass="h-3" />
        <p
          className={`flex items-center gap-1.5 text-xs ${isBalanced ? 'text-emerald-400' : overBy > 0 ? 'text-red-400' : 'text-zinc-400'}`}
          aria-live="polite"
        >
          {isBalanced ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> 100% of income allocated
            </>
          ) : overBy > 0 ? (
            <>
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Over-allocated by {formatUsd(overBy)}. Lower fixed bills or savings.
            </>
          ) : income > 0 ? (
            <>{formatUsd(unallocated)} still unallocated</>
          ) : (
            <>Enter your income, then split every dollar. The split must total 100%.</>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <AllocationRow
          id="fixed-bills"
          label="Fixed Bills"
          hint="Rent, utilities, subscriptions"
          color={ALLOCATION_COLORS.fixedBills}
          value={draft.fixedBills}
          income={income}
          onChange={setFixedBills}
        />
        <AllocationRow
          id="savings"
          label="Savings"
          hint="Monthly savings goal"
          color={ALLOCATION_COLORS.savings}
          value={draft.savings}
          income={income}
          onChange={setSavings}
        />
        <AllocationRow
          id="discretionary"
          label="Discretionary"
          hint="Auto-fills with what's left · editing it adjusts savings"
          color={ALLOCATION_COLORS.discretionary}
          value={draft.discretionary}
          income={income}
          onChange={setDiscretionary}
        />
      </div>
    </section>
  )
}
