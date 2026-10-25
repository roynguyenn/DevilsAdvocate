import { FlaskConical, ShoppingCart } from 'lucide-react'
import { useInterceptorStore } from '../store'

// How the student decides, without extra buttons: closing this returns them to the checkout. Clicking Place your
// order again for the same cart is their decision to buy (logged, and added to their transactions); leaving the
// page or checking out something else is logged as walking away.
export default function DecisionBar() {
  const hasEvaluation = useInterceptorStore((s) => s.evaluation !== null)
  const testMode = useInterceptorStore((s) => s.testMode)
  if (!hasEvaluation) return null

  return (
    <p className="flex items-start gap-1.5 border-t border-zinc-800 bg-panel px-4 pt-3 text-xs text-zinc-400">
      {testMode ? (
        <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
      ) : (
        <ShoppingCart className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span>
        Still want it? Close this and click <span className="font-medium text-zinc-200">Place your order</span> again.{' '}
        {testMode
          ? "It's added to your transactions, but nothing is ordered (testing mode)."
          : 'Your order goes through and is added to your transactions.'}
      </span>
    </p>
  )
}
