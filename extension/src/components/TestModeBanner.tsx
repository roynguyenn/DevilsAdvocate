import { FlaskConical } from 'lucide-react'
import { useInterceptorStore } from '../store'

export default function TestModeBanner() {
  const testMode = useInterceptorStore((s) => s.testMode)
  if (!testMode) return null

  return (
    <p className="flex items-center gap-2 border-b border-sky-900/60 bg-sky-950/40 px-5 py-2 text-xs text-sky-200">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Testing mode: order buttons are blocked, so nothing will be ordered.
    </p>
  )
}
