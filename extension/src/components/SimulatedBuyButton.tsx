import { FlaskConical } from 'lucide-react'
import { useInterceptorStore } from '../store'

const LABELS = {
  idle: 'Buy anyway (simulated)',
  saving: 'Logging…',
  done: 'Logged as simulated purchase',
} as const

// Lets the demo show what a purchase does to the ledger and the next score without placing a real order.
export default function SimulatedBuyButton() {
  const hasEvaluation = useInterceptorStore((s) => s.evaluation !== null)
  const purchaseState = useInterceptorStore((s) => s.purchaseState)
  const simulatePurchase = useInterceptorStore((s) => s.simulatePurchase)

  return (
    <div className="flex items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-900 px-4 pt-3">
      <p className="text-xs text-zinc-500">Demo only: nothing is ordered on Amazon.</p>
      <button
        type="button"
        onClick={() => void simulatePurchase()}
        disabled={!hasEvaluation || purchaseState !== 'idle'}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <FlaskConical className="h-3.5 w-3.5" aria-hidden />
        {LABELS[purchaseState]}
      </button>
    </div>
  )
}
