import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ShoppingCart } from 'lucide-react'
import BudgetDonut from './components/BudgetDonut'
import ChatPanel from './components/ChatPanel'
import DataSourceBadge from './components/DataSourceBadge'
import IncomeAllocation from './components/IncomeAllocation'
import RecentLedger from './components/RecentLedger'
import { formatUsd } from './format'
import { useInterceptorStore } from './store'

function ItemThumbnail() {
  const imageUrl = useInterceptorStore((s) => s.cartItemImage)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (imageUrl && imageUrl !== failedUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        onError={() => setFailedUrl(imageUrl)}
        className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain p-1"
      />
    )
  }
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-purchase/15 text-purchase">
      <ShoppingCart className="h-5 w-5" aria-hidden />
    </span>
  )
}

function DataPanel() {
  const name = useInterceptorStore((s) => s.cartItemName)
  const price = useInterceptorStore((s) => s.cartItemPrice)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex shrink-0 flex-col gap-4 rounded-xl border border-zinc-700 bg-panel p-4">
        <div className="flex items-center gap-3">
          <ItemThumbnail />
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-medium text-zinc-100">{name}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-100">{formatUsd(price)}</p>
          </div>
        </div>
        <div className="border-t border-zinc-800 pt-4">
          <IncomeAllocation />
        </div>
      </div>

      <section className="flex shrink-0 flex-col gap-3 rounded-xl border border-zinc-700 bg-panel p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Monthly budget utilization</h3>
        <BudgetDonut />
      </section>

      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-700 bg-panel p-4">
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
  )
}
