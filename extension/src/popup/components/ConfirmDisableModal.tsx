import { useEffect, useRef } from 'react'
import { ShieldOff } from 'lucide-react'

interface Props {
  onCancel: () => void
  onConfirm: () => void
}

// Disabling is the escape hatch an impulse buyer reaches for, so it takes a deliberate second click.
export default function ConfirmDisableModal({ onCancel, onConfirm }: Props) {
  const keepRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    keepRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-5" role="alertdialog" aria-modal="true" aria-labelledby="disable-title" aria-describedby="disable-body">
      <div className="flex w-full flex-col gap-4 rounded-xl border border-zinc-700 bg-panel p-5 shadow-2xl shadow-black">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
            <ShieldOff className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 id="disable-title" className="text-sm font-semibold text-zinc-100">Disable the interceptor?</h2>
            <p id="disable-body" className="mt-1 text-xs leading-relaxed text-zinc-400">
              Checkouts will go through without a challenge until you turn it back on. Your account link, budget and
              agent settings are kept.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            ref={keepRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
          >
            Keep it on
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg border border-red-500/50 px-3 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-500/10"
          >
            Disable
          </button>
        </div>
      </div>
    </div>
  )
}
