import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { Bot, CheckCircle2, Scale, SendHorizontal, ShieldX, X } from 'lucide-react'
import { MAX_USER_TURNS, useInterceptorStore, type VerdictStatus } from '../store'

const BADGES: Record<VerdictStatus, { label: string; className: string; Icon: typeof Scale } | null> = {
  idle: null,
  negotiating: { label: 'Negotiating', className: 'bg-amber-100 text-amber-900 ring-amber-300', Icon: Scale },
  blocked: { label: 'Blocked', className: 'bg-red-100 text-red-900 ring-red-300', Icon: ShieldX },
  approved: { label: 'Approved', className: 'bg-emerald-100 text-emerald-900 ring-emerald-300', Icon: CheckCircle2 },
}

function VerdictBadge() {
  const status = useInterceptorStore((s) => s.verdictStatus)
  const badge = BADGES[status]
  if (!badge) return null
  const { label, className, Icon } = badge
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${className}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  )
}

export default function ChatPanel() {
  const chatHistory = useInterceptorStore((s) => s.chatHistory)
  const close = useInterceptorStore((s) => s.close)
  const hasEvaluation = useInterceptorStore((s) => s.evaluation !== null)
  const isAgentTyping = useInterceptorStore((s) => s.isAgentTyping)
  const sendChat = useInterceptorStore((s) => s.sendChat)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')

  const turnsLeft = MAX_USER_TURNS - chatHistory.filter((m) => m.role === 'user').length
  const canSend = hasEvaluation && !isAgentTyping && turnsLeft > 0
  const placeholder = !hasEvaluation
    ? 'Waiting for the server…'
    : turnsLeft > 0
      ? `Ask about this purchase (${turnsLeft} ${turnsLeft === 1 ? 'reply' : 'replies'} left)`
      : 'Chat limit reached. The choice is yours.'

  const submit = (e: FormEvent | KeyboardEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!canSend || !text) return
    setDraft('')
    void sendChat(text)
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [chatHistory, isAgentTyping])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-neutral-900">Devil's Advocate</h2>
          <VerdictBadge />
        </div>
        <button
          type="button"
          onClick={close}
          className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          aria-label="Close and return to checkout"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {chatHistory.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {m.role === 'agent' && (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white">
                <Bot className="h-4 w-4" aria-hidden />
              </span>
            )}
            <p
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === 'agent' ? 'rounded-tl-sm bg-neutral-100 text-neutral-900' : 'rounded-tr-sm bg-neutral-900 text-white'
              }`}
            >
              {m.content}
            </p>
          </motion.div>
        ))}
        {isAgentTyping && <p className="pl-9 text-xs text-neutral-500">Thinking…</p>}
      </div>

      <form className="border-t border-neutral-200 p-4" onSubmit={submit}>
        <div className="flex items-end gap-2">
          <textarea
            disabled={!canSend}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) submit(e)
            }}
            placeholder={placeholder}
            maxLength={2000}
            className="flex-1 resize-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!canSend || !draft.trim()}
            className="rounded-lg bg-neutral-900 p-2.5 text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  )
}
