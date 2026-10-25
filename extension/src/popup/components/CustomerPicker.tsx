import { useEffect, useState } from 'react'
import { LoaderCircle, Users } from 'lucide-react'
import { callServer, type CustomerList } from '../../api'
import { usePopupStore } from '../store'

// Dev/demo control: which Nessie customer the server reads. Each customer keeps their own linked account,
// finances (in Nessie) and intensity (on the server), so switching loads theirs.
export default function CustomerPicker() {
  const switching = usePopupStore((s) => s.switchingCustomer)
  const switchCustomer = usePopupStore((s) => s.switchCustomer)
  const [list, setList] = useState<CustomerList | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    callServer<CustomerList>({ type: 'customers' }).then(setList, () => setFailed(true))
  }, [])

  const onChange = async (customerId: string) => {
    await switchCustomer(customerId)
    // Re-read so the selection reflects what the server actually switched to.
    callServer<CustomerList>({ type: 'customers' }).then(setList, () => setFailed(true))
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
      <Users className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
      <label htmlFor="customer-picker" className="shrink-0 text-[11px] text-zinc-400">
        Customer
      </label>
      {failed ? (
        <span className="text-[11px] text-red-300">Server unreachable</span>
      ) : (
        <select
          id="customer-picker"
          value={list?.current ?? ''}
          disabled={!list || switching}
          onChange={(e) => void onChange(e.target.value)}
          className="min-w-0 flex-1 truncate rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-amber-600 focus:outline-none disabled:opacity-50"
        >
          {!list && <option value="">Loading…</option>}
          {list?.customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {switching && <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" aria-label="Switching" />}
    </div>
  )
}
