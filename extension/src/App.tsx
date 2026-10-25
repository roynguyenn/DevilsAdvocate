import { AnimatePresence, motion } from 'framer-motion'
import { ShoppingCart } from 'lucide-react'
import BudgetDonut from './components/BudgetDonut'
import ChatPanel from './components/ChatPanel'
import { formatUsd, useInterceptorStore } from './store'

function DataPanel() {
  const name = useInterceptorStore((s) => s.cartItemName)
  const price = useInterceptorStore((s) => s.cartItemPrice)

  return (
    <div className="flex flex-col gap-6 overflow-y-auto p-6">
      <div className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purchase/10 text-purchase">
          <ShoppingCart className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium text-neutral-900">{name}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900">{formatUsd(price)}</p>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Monthly budget utilization</h3>
        <BudgetDonut />
      </section>
    </div>
  )
}

export default function App() {
  const isOpen = useInterceptorStore((s) => s.isOpen)
  const close = useInterceptorStore((s) => s.close)

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[2147483647] font-sans text-neutral-900">
          <motion.div
            className="absolute inset-0 bg-neutral-950/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Purchase intercepted"
            className="absolute inset-y-0 right-0 grid w-full max-w-4xl grid-cols-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] overflow-hidden bg-white shadow-2xl md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:grid-rows-1"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <div className="flex min-h-0 flex-col border-b border-neutral-200 bg-neutral-50 md:border-b-0 md:border-r">
              <DataPanel />
            </div>
            <div className="min-h-0">
              <ChatPanel />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
