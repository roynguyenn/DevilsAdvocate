import { FlaskConical, LoaderCircle, LogOut, ShoppingCart } from 'lucide-react'
import { useInterceptorStore } from '../store'

// Where the student makes the call. Either choice is logged for next time (decision memory):
//   Walk away (or X / clicking outside) -> "walked_away", and the order stays unplaced.
//   Buy it / Buy anyway -> "bought"; in Live mode their real Place Order click goes through to Amazon,
//   in Testing mode it's a simulated purchase and nothing is ordered.
export default function DecisionBar() {
  const hasEvaluation = useInterceptorStore((s) => s.evaluation !== null)
  const purchaseState = useInterceptorStore((s) => s.purchaseState)
  const approved = useInterceptorStore((s) => s.verdictStatus === 'approved')
  const testMode = useInterceptorStore((s) => s.testMode)
  const buy = useInterceptorStore((s) => s.buy)
  const close = useInterceptorStore((s) => s.close)

  // "Anyway" only makes sense when the purchase was questioned.
  const verb = approved ? 'Buy it' : 'Buy anyway'
  const label =
    purchaseState === 'saving'
      ? testMode
        ? 'Logging…'
        : 'Placing order…'
      : purchaseState === 'done'
        ? 'Logged as simulated purchase'
        : testMode
          ? `${verb} (simulated)`
          : verb

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-800 bg-panel px-4 pt-3">
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        {testMode ? (
          <>
            <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden /> Testing mode: buying is simulated, nothing is
            ordered.
          </>
        ) : (
          <>
            <ShoppingCart className="h-3.5 w-3.5 shrink-0" aria-hidden /> {verb} places your real Amazon order.
          </>
        )}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={close}
          disabled={purchaseState === 'saving'}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          Walk away
        </button>
        <button
          type="button"
          onClick={() => void buy()}
          disabled={!hasEvaluation || purchaseState !== 'idle'}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {purchaseState === 'saving' ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <ShoppingCart className="h-3.5 w-3.5" aria-hidden />
          )}
          {label}
        </button>
      </div>
    </div>
  )
}
