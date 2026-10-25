import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { SendHorizontal, X } from 'lucide-react'
import { intensityLevel } from '../intensity'
import { useInterceptorStore } from '../store'
import SimulatedBuyButton from './SimulatedBuyButton'
import TestModeBanner from './TestModeBanner'

// The Agent Intervention mode the user picked in the popup (Light / Medium / Harsh), so they can see how hard the
// agent will push back. The verdict itself isn't badged: the score's outcome is in the agent's message.
function IntensityBadge() {
  const intensity = useInterceptorStore((s) => s.intensity)
  const { persona, Icon, badgeClass } = intensityLevel(intensity)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${badgeClass}`}
      title="Agent Intervention mode (change it in the extension's popup)"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {persona}
    </span>
  )
}

export default function ChatPanel() {
  const chatHistory = useInterceptorStore((s) => s.chatHistory)
  const close = useInterceptorStore((s) => s.close)
  const hasEvaluation = useInterceptorStore((s) => s.evaluation !== null)
  const hasPrice = useInterceptorStore((s) => s.cartTotal !== null)
  const isAgentTyping = useInterceptorStore((s) => s.isAgentTyping)
  const chatClosed = useInterceptorStore((s) => s.chatClosed)
  const sendChat = useInterceptorStore((s) => s.sendChat)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')

  // No reply counter on purpose: a visible countdown invites bargaining to the last message.
  const canSend = hasPrice && hasEvaluation && !isAgentTyping && !chatClosed
  const placeholder = !hasPrice
    ? 'No price to score, so there is nothing to discuss.'
    : !hasEvaluation
      ? 'Waiting for the server…'
      : chatClosed
        ? 'Time to decide.'
        : 'Ask about this purchase…'

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
      <header className="flex items-center justify-between border-b border-zinc-800 bg-panel px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-100">Devil's Advocate</h2>
          <IntensityBadge />
        </div>
        <button
          type="button"
          onClick={close}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close and return to checkout"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <TestModeBanner />

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
              <span className="mt-0.5 shrink-0 text-xl" aria-hidden>
                😈
              </span>
            )}
            <p
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === 'agent'
                  ? 'rounded-tl-sm border border-amber-900/50 bg-amber-950/40 text-zinc-100'
                  : 'rounded-tr-sm border border-zinc-700 bg-zinc-800 text-zinc-100'
              }`}
            >
              {m.content}
            </p>
          </motion.div>
        ))}
        {isAgentTyping && <p className="pl-9 text-xs text-zinc-500">Thinking…</p>}
      </div>

      <SimulatedBuyButton />
      <form className="bg-panel p-4" onSubmit={submit}>
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
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-600 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!canSend || !draft.trim()}
            className="rounded-lg bg-amber-600 p-2.5 text-zinc-950 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Send"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  )
}