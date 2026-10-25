import { create } from 'zustand'
import { callServer } from './api'
import { formatUsd } from './format'
import type { Intensity, Settings } from './settings'

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
  imageUrl: string | null
}

export type TransactionCategory = 'shopping' | 'transport' | 'coffee' | 'groceries' | 'dining' | 'subscriptions'

// Mirrors a Nessie /purchases record after the backend maps merchant_id → name/category.
export interface Transaction {
  id: string
  merchant: string
  category: TransactionCategory
  amount: number
  timestamp: number
  // True for "Buy anyway" purchases logged by the server; no real order exists.
  simulated?: boolean
}

// What the server's charts data looks like (server/app.py _snapshot_for_ui).
export interface ServerSnapshot {
  budget: number
  spent_this_month: number
  balance: number
  transactions: Transaction[]
}

// Shape returned by the server's POST /evaluate. The score itself never leaves the server; only the verdict does.
export interface Evaluation {
  action: 'inform' | 'nudge' | 'block'
  message: string
  snapshot: ServerSnapshot
}

const fromSnapshot = (s: ServerSnapshot) => ({ totalBudget: s.budget, spent: s.spent_this_month, ledger: s.transactions })

interface InterceptorState {
  // Income split comes from the popup's saved Settings; the rest is a mock financial snapshot,
  // replaced by the backend's cached snapshot during streaming wire-up.
  monthlyIncome: number
  fixedBills: number
  savings: number
  // Discretionary budget for the month.
  totalBudget: number
  intensity: Intensity
  spent: number
  daysUntilPayday: number
  ledger: Transaction[]

  cartItemName: string
  cartItemPrice: number
  cartItemImage: string | null

  isOpen: boolean
  verdictStatus: VerdictStatus
  chatHistory: ChatMessage[]
  evaluation: Evaluation | null
  isAgentTyping: boolean
  purchaseState: 'idle' | 'saving' | 'done'

  applySettings: (settings: Settings) => void
  openIntercept: (item: InterceptedItem) => void
  applyEvaluation: (e: Evaluation) => void
  pushMessage: (role: ChatMessage['role'], content: string) => void
  sendChat: (text: string) => Promise<void>
  simulatePurchase: () => Promise<void>
  close: () => void
}

const makeId = () => Math.random().toString(36).slice(2, 10)

const HOUR = 3_600_000
const hoursAgo = (h: number) => Date.now() - h * HOUR

const MOCK_LEDGER: Transaction[] = [
  { id: 't1', merchant: 'Amazon.com', category: 'shopping', amount: 45.2, timestamp: hoursAgo(19) },
  { id: 't2', merchant: 'Uber', category: 'transport', amount: 18.5, timestamp: hoursAgo(26) },
  { id: 't3', merchant: 'Starbucks', category: 'coffee', amount: 6.12, timestamp: hoursAgo(50) },
  { id: 't4', merchant: 'Whole Foods Market', category: 'groceries', amount: 82.37, timestamp: hoursAgo(75) },
  { id: 't5', merchant: 'Amazon.com', category: 'shopping', amount: 129.99, timestamp: hoursAgo(98) },
  { id: 't6', merchant: 'Netflix', category: 'subscriptions', amount: 15.49, timestamp: hoursAgo(122) },
  { id: 't7', merchant: 'Chipotle', category: 'dining', amount: 13.85, timestamp: hoursAgo(146) },
  { id: 't8', merchant: 'Lyft', category: 'transport', amount: 22.1, timestamp: hoursAgo(193) },
  { id: 't9', merchant: 'Amazon.com', category: 'shopping', amount: 64.0, timestamp: hoursAgo(240) },
]

const CLOSING_LINE: Record<Intensity, string> = {
  light: 'Are you sure you want this?',
  medium: 'Defend this purchase.',
  harsh: "That's money you promised to your savings goal. Convince me, and make it good.",
}

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
    `until payday. ${CLOSING_LINE[s.intensity]}`
  )
}

export const useInterceptorStore = create<InterceptorState>((set, get) => ({
  monthlyIncome: 4500,
  fixedBills: 1800,
  savings: 1900,
  totalBudget: 800,
  intensity: 'medium',
  spent: 540,
  daysUntilPayday: 9,
  ledger: MOCK_LEDGER,

  cartItemName: 'Sony WH-1000XM5 Wireless Headphones',
  cartItemPrice: 179.99,
  cartItemImage: null,

  isOpen: false,
  verdictStatus: 'idle',
  chatHistory: [],
  evaluation: null,
  isAgentTyping: false,
  purchaseState: 'idle',

  applySettings: (settings) =>
    set({
      monthlyIncome: settings.monthlyIncome,
      fixedBills: settings.fixedBills,
      savings: settings.savings,
      totalBudget: settings.discretionary,
      intensity: settings.intensity,
    }),

  openIntercept: (item) =>
    set({
      isOpen: true,
      verdictStatus: 'negotiating',
      cartItemName: item.name,
      cartItemPrice: item.price,
      cartItemImage: item.imageUrl,
      evaluation: null,
      isAgentTyping: false,
      purchaseState: 'idle',
      chatHistory: [{ id: makeId(), role: 'agent', content: mockOpeningSalvo(get(), item) }],
    }),

  // The server's message replaces the mock opening once it arrives, and its snapshot replaces the mock
  // budget/spent/ledger so the charts match the numbers the verdict used.
  applyEvaluation: (e) =>
    set({
      ...fromSnapshot(e.snapshot),
      evaluation: e,
      verdictStatus: e.action === 'block' ? 'blocked' : 'negotiating',
      // The score stays internal (it only decides the verdict); the user sees the explanation alone.
      chatHistory: [{ id: makeId(), role: 'agent', content: e.message }],
    }),

  // SIMULATED: logs the purchase on the server so the ledger and next score reflect it. The checkout click
  // stays blocked, so no Amazon order is placed.
  simulatePurchase: async () => {
    const { evaluation, purchaseState, cartItemName, cartItemPrice, pushMessage } = get()
    if (!evaluation || purchaseState !== 'idle') return
    set({ purchaseState: 'saving' })
    try {
      const res = await callServer<{ snapshot: ServerSnapshot }>({
        type: 'purchase',
        purchase: { title: cartItemName, price: cartItemPrice },
      })
      set({ ...fromSnapshot(res.snapshot), purchaseState: 'done' })
      pushMessage(
        'agent',
        `Logged ${formatUsd(cartItemPrice)} as a simulated purchase. No order was placed. ` +
          'It now counts toward your spending, so your next check starts from here.',
      )
    } catch {
      set({ purchaseState: 'idle' })
      pushMessage('agent', "I couldn't reach the server, so nothing was logged.")
    }
  },

  pushMessage: (role, content) =>
    set((s) => ({ chatHistory: [...s.chatHistory, { id: makeId(), role, content }] })),

  // Chat can explain the verdict but never change it: the reply is text only, and the verdict stays as evaluated.
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
      pushMessage('agent', "I couldn't reach the server. Nothing about this order has changed.")
    } finally {
      set({ isAgentTyping: false })
    }
  },

  close: () => set({ isOpen: false, verdictStatus: 'idle' }),
}))
