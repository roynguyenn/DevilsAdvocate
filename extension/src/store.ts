import { create } from 'zustand'

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

  openIntercept: (item: InterceptedItem) => void
  pushMessage: (role: ChatMessage['role'], content: string) => void
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

  openIntercept: (item) =>
    set({
      isOpen: true,
      verdictStatus: 'negotiating',
      cartItemName: item.name,
      cartItemPrice: item.price,
      chatHistory: [{ id: makeId(), role: 'agent', content: mockOpeningSalvo(get(), item) }],
    }),

  pushMessage: (role, content) =>
    set((s) => ({ chatHistory: [...s.chatHistory, { id: makeId(), role, content }] })),

  close: () => set({ isOpen: false, verdictStatus: 'idle' }),
}))
