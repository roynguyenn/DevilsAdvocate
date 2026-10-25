import { create } from 'zustand'
import { callServer } from './api'

// Mirrors MAX_USER_TURNS in server/app.py, which is the one that actually enforces it.
export const MAX_USER_TURNS = 3

export type VerdictStatus = 'idle' | 'negotiating' | 'blocked' | 'approved'

export interface ChatMessage {
  id: string
  role: 'agent' | 'user'
  content: string
}

export interface InterceptedItem {
  name: string
  price: number
}

// Shape returned by the server's POST /evaluate (server/score.py evaluate() + message).
export interface Evaluation {
  score_before: number
  score_after: number
  action: 'inform' | 'nudge' | 'block'
  mode: 'aware' | 'strict'
  message: string
}

interface InterceptorState {
  // Mock financial snapshot — replaced by the backend's cached snapshot during streaming wire-up.
  totalBudget: number
  spent: number
  daysUntilPayday: number

  cartItemName: string
  cartItemPrice: number

  isOpen: boolean
  verdictStatus: VerdictStatus
  chatHistory: ChatMessage[]
  evaluation: Evaluation | null
  isAgentTyping: boolean

  openIntercept: (item: InterceptedItem) => void
  applyEvaluation: (e: Evaluation) => void
  pushMessage: (role: ChatMessage['role'], content: string) => void
  sendChat: (text: string) => Promise<void>
  close: () => void
}

const makeId = () => Math.random().toString(36).slice(2, 10)

export const formatUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function mockOpeningSalvo(s: InterceptorState, item: InterceptedItem): string {
  const remaining = s.totalBudget - s.spent
  const after = remaining - item.price
  const pct = Math.round((item.price / s.totalBudget) * 100)
  const outcome =
    after < 0
      ? `puts you ${formatUsd(-after)} over budget`
      : `leaves you ${formatUsd(after)} for the next ${s.daysUntilPayday} days`
  return (
    `You've already spent ${formatUsd(s.spent)} of your ${formatUsd(s.totalBudget)} ` +
    `discretionary budget this month. "${item.name}" eats another ${pct}% of it and ${outcome} ` +
    `until payday. Defend this purchase.`
  )
}

export const useInterceptorStore = create<InterceptorState>((set, get) => ({
  totalBudget: 800,
  spent: 540,
  daysUntilPayday: 9,

  cartItemName: 'Sony WH-1000XM5 Wireless Headphones',
  cartItemPrice: 179.99,

  isOpen: false,
  verdictStatus: 'idle',
  chatHistory: [],
  evaluation: null,
  isAgentTyping: false,

  openIntercept: (item) =>
    set({
      isOpen: true,
      verdictStatus: 'negotiating',
      cartItemName: item.name,
      cartItemPrice: item.price,
      evaluation: null,
      isAgentTyping: false,
      chatHistory: [{ id: makeId(), role: 'agent', content: mockOpeningSalvo(get(), item) }],
    }),

  // The server's deterministic score replaces the mock opening message once it arrives.
  applyEvaluation: (e) =>
    set({
      evaluation: e,
      verdictStatus: e.action === 'block' ? 'blocked' : 'negotiating',
      chatHistory: [{ id: makeId(), role: 'agent', content: `Score ${e.score_before} → ${e.score_after}. ${e.message}` }],
    }),

  pushMessage: (role, content) =>
    set((s) => ({ chatHistory: [...s.chatHistory, { id: makeId(), role, content }] })),

  // Chat can explain the score but never change it: the reply is text only, and the verdict stays as evaluated.
  sendChat: async (text) => {
    const { evaluation, isAgentTyping, cartItemName, cartItemPrice, pushMessage } = get()
    if (!evaluation || isAgentTyping) return
    pushMessage('user', text)
    set({ isAgentTyping: true })
    const history = get().chatHistory.map((m) => ({
      role: m.role === 'agent' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }))
    try {
      const res = await callServer<{ reply: string }>({
        type: 'chat',
        purchase: { title: cartItemName, price: cartItemPrice },
        history,
      })
      pushMessage('agent', res.reply)
    } catch {
      pushMessage('agent', "I couldn't reach the server. The score above still stands.")
    } finally {
      set({ isAgentTyping: false })
    }
  },

  close: () => set({ isOpen: false, verdictStatus: 'idle' }),
}))
