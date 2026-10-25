import { AnimatePresence, motion } from 'framer-motion'
import BudgetDonut from './components/BudgetDonut'
import CartItems from './components/CartItems'
import ChatPanel from './components/ChatPanel'
import DataSourceBadge from './components/DataSourceBadge'
import NoticeToast from './components/NoticeToast'
import IncomeAllocation from './components/IncomeAllocation'
import RecentLedger from './components/RecentLedger'
import { useInterceptorStore } from './store'

function DataPanel() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex shrink-0 flex-col gap-4 rounded-xl border border-zinc-700 bg-panel p-4">
        <CartItems />
        <div className="border-t border-zinc-800 pt-4">
          <IncomeAllocation />
        </div>
      </div>

      <section className="flex shrink-0 flex-col gap-3 rounded-xl border border-zinc-700 bg-panel p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Monthly budget utilization</h3>
        <BudgetDonut />
      </section>

      {/* No min-h-0: the card must never shrink below its rows (they spilled past its border); the panel scrolls. */}
      <div className="flex flex-1 flex-col rounded-xl border border-zinc-700 bg-panel p-4">
        <RecentLedger />
      </div>

      <DataSourceBadge />
    </div>
  )
}

export default function App() {
  const isOpen = useInterceptorStore((s) => s.isOpen)
  const close = useInterceptorStore((s) => s.close)

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[2147483647] font-sans text-zinc-100 [color-scheme:dark]">
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Purchase intercepted"
              className="absolute inset-y-0 right-0 grid w-full max-w-5xl grid-cols-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] overflow-hidden border-l border-zinc-800 bg-base shadow-2xl shadow-black md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-1"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            >
              <div className="flex min-h-0 flex-col border-b border-zinc-800 md:border-b-0 md:border-r">
                <DataPanel />
              </div>
              <div className="min-h-0">
                <ChatPanel />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <NoticeToast />
    </>
  )
}
