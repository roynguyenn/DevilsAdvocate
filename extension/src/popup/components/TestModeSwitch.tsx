import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { loadTestMode, onTestModeChanged, saveTestMode } from '../../settings'

// Developer safety switch. Reads and writes chrome.storage directly (not the popup draft), so flipping it
// takes effect immediately and never shows up as an unsaved change.
export default function TestModeSwitch() {
  const [on, setOn] = useState<boolean | null>(null)

  useEffect(() => {
    loadTestMode().then(setOn, () => setOn(true))
    return onTestModeChanged(setOn)
  }, [])

  if (on === null) return null

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Testing mode"
      title={on ? 'Testing mode: order buttons are always blocked' : 'Testing mode off: real orders are possible'}
      onClick={() => void saveTestMode(!on)}
      className="flex shrink-0 items-center gap-2 rounded-full py-0.5 pl-2.5 pr-1 text-[11px] font-medium ring-1 ring-zinc-700 transition-colors hover:ring-zinc-600"
    >
      <FlaskConical className={`h-3 w-3 ${on ? 'text-sky-300' : 'text-zinc-500'}`} aria-hidden />
      <span className={on ? 'text-sky-300' : 'text-zinc-400'}>{on ? 'Testing' : 'Live'}</span>
      <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-sky-500' : 'bg-zinc-700'}`}>
        <span
          className={`absolute left-0 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-3.5' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  )
}
