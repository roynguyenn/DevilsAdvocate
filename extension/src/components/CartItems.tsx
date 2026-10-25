import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { formatUsd } from '../format'
import { useInterceptorStore } from '../store'

function ItemThumbnail({ imageUrl }: { imageUrl: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (imageUrl && imageUrl !== failedUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        onError={() => setFailedUrl(imageUrl)}
        className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain p-1"
      />
    )
  }
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-purchase/15 text-purchase">
      <ShoppingCart className="h-5 w-5" aria-hidden />
    </span>
  )
}

// Every item in the intercepted cart, then the total that gets scored.
export default function CartItems() {
  const items = useInterceptorStore((s) => s.cart)
  const total = useInterceptorStore((s) => s.cartTotal)
  const isFinal = useInterceptorStore((s) => s.cartTotalIsFinal)
  const count = items.reduce((n, i) => n + i.quantity, 0)

  return (
    <section className="flex flex-col gap-3" aria-label="Cart">
      <ul className="-mr-2 flex max-h-48 flex-col gap-3 overflow-y-auto pr-2">
        {items.map((item, index) => (
          <li key={`${index}-${item.name}`} className="flex items-center gap-3">
            <ItemThumbnail imageUrl={item.imageUrl} />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium text-zinc-100">{item.name}</p>
              {item.quantity > 1 && <p className="text-xs text-zinc-400">Qty {item.quantity}</p>}
            </div>
            {item.price !== null && items.length > 1 && (
              <span className="shrink-0 text-sm tabular-nums text-zinc-300">{formatUsd(item.price * item.quantity)}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t border-zinc-800 pt-3">
        <span className="text-xs text-zinc-400">
          {count} {count === 1 ? 'item' : 'items'}
          {total !== null && (isFinal ? ' · incl. shipping & tax' : ' · before shipping & tax')}
        </span>
        {total === null ? (
          <span className="text-sm text-zinc-400">Price not found on this page</span>
        ) : (
          <span className="text-lg font-semibold tabular-nums text-zinc-100">{formatUsd(total)}</span>
        )}
      </div>
    </section>
  )
}
