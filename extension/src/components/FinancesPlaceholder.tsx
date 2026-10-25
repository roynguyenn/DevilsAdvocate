import { LoaderCircle } from 'lucide-react'
import { useInterceptorStore } from '../store'

// Stands in for a chart until the server's snapshot arrives, so the panel never shows made-up numbers.
export default function FinancesPlaceholder({ className = '' }: { className?: string }) {
  const error = useInterceptorStore((s) => s.financesError)
  return (
    <p className={`flex items-center justify-center gap-2 text-sm text-zinc-500 ${className}`} aria-live="polite">
      {error ?? (
        <>
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading from your bank…
        </>
      )}
    </p>
  )
}
