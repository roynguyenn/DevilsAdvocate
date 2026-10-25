import { Car, Coffee, ShoppingBag, ShoppingBasket, Tv, Utensils, type LucideIcon } from 'lucide-react'
import { formatTimeAgo, formatUsd } from '../format'
import { useInterceptorStore, type TransactionCategory } from '../store'

const CATEGORY_ICONS: Record<TransactionCategory, LucideIcon> = {
  shopping: ShoppingBag,
  transport: Car,
  coffee: Coffee,
  groceries: ShoppingBasket,
  dining: Utensils,
  subscriptions: Tv,
}

export default function RecentLedger() {
  const ledger = useInterceptorStore((s) => s.ledger)

  return (
    <section className="flex min-h-[13rem] flex-1 flex-col gap-3" aria-label="Recent ledger">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Recent Ledger (Transaction History)</h3>
      <ul className="-mr-2 min-h-0 flex-1 divide-y divide-zinc-800 overflow-y-auto pr-2">
        {ledger.map((t) => {
          const Icon = CATEGORY_ICONS[t.category]
          return (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-300">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">{t.merchant}</p>
                <p className="text-xs text-zinc-400">{formatTimeAgo(t.timestamp)}</p>
              </div>
              <span className="text-sm font-medium tabular-nums text-zinc-100">−{formatUsd(t.amount)}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
