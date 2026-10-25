import { useEffect, useState } from 'react'
import { Landmark, LoaderCircle, Lock, X } from 'lucide-react'
import { authorizeAccount, fetchAuthorizableAccounts } from '../../api/bank'
import type { LinkedAccount } from '../../settings'

interface Props {
  onClose: () => void
  onLinked: (account: LinkedAccount) => void
}

export default function ConnectBankModal({ onClose, onLinked }: Props) {
  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAuthorizableAccounts().then(
      (list) => {
        if (cancelled) return
        setAccounts(list)
        setSelectedId(list[0]?.id ?? null)
      },
      () => !cancelled && setLoadError("Couldn't reach the Devil's Advocate server. Is it running on port 3001?"),
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !authorizing && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [authorizing, onClose])

  const authorize = async () => {
    const account = accounts?.find((a) => a.id === selectedId)
    if (!account) return
    setAuthorizing(true)
    onLinked(await authorizeAccount(account))
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-5" role="dialog" aria-modal="true" aria-labelledby="connect-title">
      <div className="w-full rounded-xl border border-zinc-700 bg-panel shadow-2xl shadow-black">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#004977] text-white">
              <Landmark className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 id="connect-title" className="text-sm font-semibold text-zinc-100">Capital One</h2>
              <p className="text-[11px] text-zinc-400">Nessie sandbox · simulated sign-in</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={authorizing}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-zinc-400">Choose the account Devil's Advocate may read transactions from.</p>
          {loadError ? (
            <p className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300" role="alert">
              {loadError}
            </p>
          ) : accounts === null ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-400">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading accounts…
            </div>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Accounts</legend>
              {accounts.map((a) => (
                <label
                  key={a.id}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    selectedId === a.id ? 'border-amber-500/70 bg-amber-500/10' : 'border-zinc-700 hover:border-zinc-600'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="account"
                      value={a.id}
                      checked={selectedId === a.id}
                      onChange={() => setSelectedId(a.id)}
                      className="accent-amber-500"
                    />
                    <span className="text-zinc-100">{a.nickname}</span>
                  </span>
                  <span className="tabular-nums text-zinc-400">****{a.last4}</span>
                </label>
              ))}
            </fieldset>
          )}
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Lock className="h-3 w-3" aria-hidden /> Credentials stay with the bank — the extension only stores the account name.
          </p>
          <button
            type="button"
            onClick={authorize}
            disabled={!selectedId || authorizing}
            className="flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {authorizing && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
            {authorizing ? 'Authorizing…' : 'Authorize access'}
          </button>
        </div>
      </div>
    </div>
  )
}
