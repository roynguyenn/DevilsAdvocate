import { ArrowDownLeft, CheckCircle2, Landmark, Lock, Receipt, ShoppingBag, type LucideIcon } from 'lucide-react'
import { usePopupStore } from '../store'
import CustomerPicker from './CustomerPicker'

interface Props {
  onConnect: () => void
}

const READS: { Icon: LucideIcon; label: string; detail: string }[] = [
  { Icon: ShoppingBag, label: 'Purchases', detail: 'to see where your discretionary money goes' },
  { Icon: ArrowDownLeft, label: 'Deposits', detail: 'to know when payday is coming' },
  { Icon: Receipt, label: 'Bills', detail: 'to keep fixed costs off the table' },
]

export default function AccountCard({ onConnect }: Props) {
  const account = usePopupStore((s) => s.draft.account)
  const unlinkAccount = usePopupStore((s) => s.unlinkAccount)

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-panel p-4" aria-labelledby="account-title">
      <div>
        <h2 id="account-title" className="text-sm font-semibold text-zinc-100">Account Connection</h2>
        <p className="text-xs text-zinc-400">The agent reads your real spending through Capital One.</p>
      </div>

      <CustomerPicker />

      {account ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">
              Linked: {account.nickname} ending in <span className="tabular-nums">****{account.last4}</span>
            </span>
          </span>
          <button
            type="button"
            onClick={unlinkAccount}
            className="shrink-0 text-xs text-zinc-400 underline-offset-2 hover:text-zinc-100 hover:underline"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          className="flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-zinc-950 shadow-lg shadow-amber-500/10 hover:bg-amber-400"
        >
          <Landmark className="h-4 w-4" aria-hidden />
          Connect Bank Account
        </button>
      )}

      <div className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">What the agent reads</h3>
        <ul className="flex flex-col gap-2">
          {READS.map(({ Icon, label, detail }) => (
            <li key={label} className="flex items-center gap-2.5 text-xs">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-300">
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span>
                <span className="font-medium text-zinc-100">{label}</span>
                <span className="text-zinc-400"> {detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Lock className="h-3 w-3 shrink-0" aria-hidden /> Read-only. Your bank credentials are never stored in the extension.
        </p>
      </div>
    </section>
  )
}
