import { Database } from 'lucide-react'
import { useInterceptorStore } from '../store'

// Dev aid: shows which data the server read: a Nessie customer, or the Finances tab only (no bank linked).
export default function DataSourceBadge() {
  const source = useInterceptorStore((s) => s.dataSource)

  const label = !source
    ? 'Data: mock (server not connected)'
    : source.type === 'manual'
      ? 'Data: Finances tab only (no bank linked)'
      : `Data: Nessie · ${source.customer_name} · customer ${source.customer_id}`

  return (
    <p className="flex shrink-0 items-center gap-1.5 truncate px-1 text-[11px] text-zinc-500" title={label}>
      <Database className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </p>
  )
}
