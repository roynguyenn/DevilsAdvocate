import type { ClipboardEvent, SyntheticEvent } from 'react'
import { formatUsd } from '../../format'

interface Props {
  id?: string
  value: number
  onChange: (value: number) => void
  ariaLabel: string
  className?: string
  disabled?: boolean
}

const MAX_CENTS = 999_999_999 // $9,999,999.99

// Cash-register entry: always displays "$0.00"-style currency, and digits shift in from the right
// (typing 4-5-0-0-0-0 reads $0.04 → $0.45 → … → $4,500.00). Backspace drops the last digit.
// The caret is pinned to the end so edits always apply to the cents place.
export default function CurrencyInput({ id, value, onChange, ariaLabel, className = '', disabled }: Props) {
  const cents = Math.round(value * 100)

  const commit = (nextCents: number) => {
    if (nextCents <= MAX_CENTS) onChange(nextCents / 100)
  }

  // Select-all is allowed (typing then replaces the amount); any partial selection collapses to the end.
  const pinCaretToEnd = (e: SyntheticEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const end = input.value.length
    const { selectionStart: start, selectionEnd: stop } = input
    const isSelectAll = start === 0 && stop === end && end > 0
    if (!isSelectAll && (start !== end || stop !== end)) input.setSelectionRange(end, end)
  }

  // Pasted text is read as a dollar amount ("1,234.5" → $1,234.50), not as raw cents digits.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const dollars = Number(e.clipboardData.getData('text').replace(/[^0-9.]/g, ''))
    if (Number.isFinite(dollars)) commit(Math.round(dollars * 100))
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      disabled={disabled}
      value={formatUsd(cents / 100)}
      onChange={(e) => commit(Number(e.target.value.replace(/\D/g, '') || '0'))}
      onPaste={onPaste}
      onFocus={pinCaretToEnd}
      onClick={pinCaretToEnd}
      onSelect={pinCaretToEnd}
      className={`rounded-lg border border-zinc-700 bg-zinc-800 tabular-nums text-zinc-100 caret-amber-500 focus:border-amber-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  )
}
