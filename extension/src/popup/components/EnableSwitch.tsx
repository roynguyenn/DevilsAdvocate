import { useState } from 'react'
import ConfirmDisableModal from './ConfirmDisableModal'
import { selectCanEnable, usePopupStore } from '../store'

export default function EnableSwitch() {
  const active = usePopupStore((s) => s.saved.active)
  const canEnable = usePopupStore(selectCanEnable)
  const setActive = usePopupStore((s) => s.setActive)
  const [confirming, setConfirming] = useState(false)

  const unavailable = !active && !canEnable

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label="Interceptor enabled"
        disabled={unavailable}
        title={unavailable ? 'Finish setup and save to enable the interceptor' : active ? 'Disable the interceptor' : 'Enable the interceptor'}
        onClick={() => (active ? setConfirming(true) : setActive(true))}
        className="group flex shrink-0 items-center gap-2 rounded-full py-0.5 pl-2.5 pr-1 text-[11px] font-medium ring-1 ring-zinc-700 transition-colors hover:ring-zinc-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:ring-zinc-700"
      >
        <span className={active ? 'text-emerald-300' : 'text-zinc-400'}>{active ? 'Enabled' : 'Disabled'}</span>
        <span className={`relative h-4 w-7 rounded-full transition-colors ${active ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
          <span
            className={`absolute left-0 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-3.5' : 'translate-x-0.5'}`}
          />
        </span>
      </button>

      {confirming && (
        <ConfirmDisableModal
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            setActive(false)
          }}
        />
      )}
    </>
  )
}
