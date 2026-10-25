import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { formatUsd, useInterceptorStore } from '../store'

const COLORS = {
  spent: '#2a78d6',
  purchase: '#eb6834',
  remaining: '#e7e5e0',
}

interface Slice {
  key: keyof typeof COLORS
  label: string
  value: number
}

export default function BudgetDonut() {
  const totalBudget = useInterceptorStore((s) => s.totalBudget)
  const spent = useInterceptorStore((s) => s.spent)
  const price = useInterceptorStore((s) => s.cartItemPrice)

  const afterPurchase = spent + price
  const remaining = Math.max(totalBudget - afterPurchase, 0)
  const overBy = Math.max(afterPurchase - totalBudget, 0)
  const utilization = Math.round((afterPurchase / totalBudget) * 100)

  // The purchase slice sits immediately after "spent" so it reads as the next chunk of the budget being eaten.
  const data: Slice[] = [
    { key: 'spent', label: 'Spent this month', value: spent },
    { key: 'purchase', label: 'This purchase', value: price },
    { key: 'remaining', label: 'Remaining', value: remaining },
  ]
  const visible = data.filter((d) => d.value > 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visible}
              dataKey="value"
              nameKey="label"
              innerRadius="68%"
              outerRadius="92%"
              startAngle={90}
              endAngle={-270}
              cornerRadius={4}
              stroke="#ffffff"
              strokeWidth={2}
              animationBegin={0}
              animationDuration={500}
            >
              {visible.map((d) => (
                <Cell key={d.key} fill={COLORS[d.key]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatUsd(Number(value))}
              contentStyle={{ borderRadius: 8, border: '1px solid #e7e5e0', fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums text-neutral-900">{utilization}%</span>
          <span className="text-xs text-neutral-500">used after purchase</span>
        </div>
      </div>

      <ul className="flex flex-col gap-2 text-sm">
        {data.map((d) => (
          <li key={d.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-neutral-600">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLORS[d.key] }} />
              {d.label}
            </span>
            <span className="font-medium tabular-nums text-neutral-900">{formatUsd(d.value)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between border-t border-neutral-200 pt-2">
          <span className="text-neutral-600">Monthly budget</span>
          <span className="font-medium tabular-nums text-neutral-900">{formatUsd(totalBudget)}</span>
        </li>
      </ul>

      {overBy > 0 && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          This purchase puts you <span className="font-semibold">{formatUsd(overBy)}</span> over budget.
        </p>
      )}
    </div>
  )
}
