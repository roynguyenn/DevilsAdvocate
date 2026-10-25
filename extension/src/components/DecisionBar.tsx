import { CheckCircle2, FlaskConical, MessageSquareWarning } from 'lucide-react'
import { useInterceptorStore } from '../store'

// The overlay only opens when the score flags a purchase, and then the agent is the judge: the order starts not
// approved and Claude can approve it in the chat. Either way the student decides by closing this and clicking Place
// your order again (always allowed; without approval it's logged as bought_unapproved).
export default function DecisionBar() {
  const hasEvaluation = useInterceptorStore((s) => s.evaluation !== null)
  const approved = useInterceptorStore((s) => s.agentApproved)
  const testMode = useInterceptorStore((s) => s.testMode)
  if (!hasEvaluation) return null

  const how = testMode ? ' It will be logged as a purchase; nothing is ordered (testing mode).' : ''
  return (
    <div className="flex flex-col gap-1 border-t border-zinc-800 bg-panel px-4 pt-3 text-xs">
      {approved ? (
        <p className="flex items-center gap-1.5 font-medium text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> Approved
        </p>
      ) : (
        <p className="flex items-center gap-1.5 font-medium text-amber-300">
          <MessageSquareWarning className="h-3.5 w-3.5 shrink-0" aria-hidden /> Not approved yet: make your case
        </p>
      )}
      <p className="flex items-start gap-1.5 text-zinc-400">
        {testMode && <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />}
        <span>
          {approved
            ? 'Close this and click Place your order to buy it.'
            : 'You can still close this and click Place your order to buy it anyway; that gets noted.'}
          {how}
        </span>
      </p>
    </div>
  )
}
