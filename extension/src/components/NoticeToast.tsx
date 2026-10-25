import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, LoaderCircle } from 'lucide-react'
import { useInterceptorStore } from '../store'

// Small status in the corner while the overlay is closed: "Checking…" while the score is pending (a fine score
// never opens the overlay), then confirmations like a purchase being logged.
export default function NoticeToast() {
  const notice = useInterceptorStore((s) => s.notice)
  const isOpen = useInterceptorStore((s) => s.isOpen)
  const checking = useInterceptorStore((s) => s.checking)
  const text = notice ?? (checking ? 'Checking this purchase…' : null)

  return (
    <AnimatePresence>
      {text && !isOpen && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="fixed bottom-5 right-5 z-[2147483647] flex max-w-sm items-start gap-2 rounded-xl border border-zinc-700 bg-panel px-4 py-3 font-sans text-sm text-zinc-100 shadow-2xl shadow-black"
        >
          {notice ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          ) : (
            <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-zinc-400" aria-hidden />
          )}
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
