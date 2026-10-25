import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import { useInterceptorStore } from '../store'

// Confirms what happened after the overlay is gone, e.g. a purchase logged on the second Place Order click.
export default function NoticeToast() {
  const notice = useInterceptorStore((s) => s.notice)
  const isOpen = useInterceptorStore((s) => s.isOpen)

  return (
    <AnimatePresence>
      {notice && !isOpen && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="fixed bottom-5 right-5 z-[2147483647] flex max-w-sm items-start gap-2 rounded-xl border border-zinc-700 bg-panel px-4 py-3 font-sans text-sm text-zinc-100 shadow-2xl shadow-black"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          {notice}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
