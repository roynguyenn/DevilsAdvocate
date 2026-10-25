import { create } from 'zustand'
import { callServer } from './api'
import { formatUsd } from './format'
import type { Intensity, Settings } from './settings'

export type VerdictStatus = 'idle' | 'negotiating' | 'blocked' | 'approved'

export interface ChatMessage {
  id: string
  role: 'agent' | 'user'
  content: string
}

export interface InterceptedItem {
  name: string
  // null when the checkout page's price couldn't be read; we never substitute a made-up one.
  price: number | null
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

// Which data the server read (server/snapshot.py describe_source). Shown so developers know what they're testing.
export type DataSource =
  | { type: 'seed' }
  | { type: 'nessie'; customer_id: string; account_id: string; customer_name: string }

// What the server's charts data looks like (server/app.py _snapshot_for_ui), all read from Nessie.
export interface ServerSnapshot {
  monthly_income: number
  monthly_bills: number
  savings: number
  // Discretionary budget: income - fixed bills - savings.
  budget: number
  spent_this_month: number
  balance: number
  transactions: Transaction[]
  source: DataSource
}

// Shape returned by the server's POST /evaluate. The score itself never leaves the server; only the verdict does.
export interface Evaluation {
  action: 'inform' | 'nudge' | 'block'
  message: string
  snapshot: ServerSnapshot
}

const VERDICT_FOR_ACTION: Record<Evaluation['action'], VerdictStatus> = {
  inform: 'approved',
  nudge: 'negotiating',
  block: 'blocked',
}

// The numbers the left panel draws. Only ever filled from the server, so the charts match the score.
export interface Finances {
  monthlyIncome: number
  fixedBills: number
  savings: number
  budget: number
  spent: number
  ledger: Transaction[]
}

const fromSnapshot = (s: ServerSnapshot): Finances => ({
  monthlyIncome: s.monthly_income,
  fixedBills: s.monthly_bills,
  savings: s.savings,
  budget: s.budget,
  spent: s.spent_this_month,
  ledger: s.transactions,
})

interface InterceptorState {
  // null until the server answers; the charts show a placeholder rather than made-up numbers.
  finances: Finances | null
  // Why the left panel has no data, once that's known (no price on the page, server or bank down).
  financesError: string | null
  intensity: Intensity
  // Which data the server read; shown at the bottom of the left panel (DataSourceBadge).
  dataSource: DataSource | null

  cartItemName: string
  cartItemPrice: number | null
  cartItemImage: string | null

  isOpen: boolean
  verdictStatus: VerdictStatus
  chatHistory: ChatMessage[]
  evaluation: Evaluation | null
  isAgentTyping: boolean
  // Set when the server wraps the chat up. The reply cap lives only on the server and is never shown.
  chatClosed: boolean
  purchaseState: 'idle' | 'saving' | 'done'
  // Mirrors the popup's Testing switch (settings.ts) so the overlay can say no order will be placed.
  testMode: boolean

  applySettings: (settings: Settings) => void
  setTestMode: (on: boolean) => void
  openIntercept: (item: InterceptedItem) => void
  applyEvaluation: (e: Evaluation) => void
  failEvaluation: () => void
  pushMessage: (role: ChatMessage['role'], content: string) => void
  sendChat: (text: string) => Promise<void>
  simulatePurchase: () => Promise<void>
  close: () => void
}

const makeId = () => Math.random().toString(36).slice(2, 10)

const CLOSING_LINE: Record<Intensity, string> = {
  light: 'Are you sure you want this?',
  medium: 'Defend this purchase.',
  harsh: "That's money you promised to your savings goal. Convince me, and make it good.",
}

// Shown until the server's score arrives. No numbers: every figure on screen comes from the server.
const pendingMessage = (s: InterceptorState, item: InterceptedItem) =>
  `Checking "${item.name}" against your accounts… ${CLOSING_LINE[s.intensity]}`

export const useInterceptorStore = create<InterceptorState>((set, get) => ({
  finances: null,
  financesError: null,
  intensity: 'medium',
  dataSource: null,

  cartItemName: '',
  cartItemPrice: null,
  cartItemImage: null,

  isOpen: false,
  verdictStatus: 'idle',
  chatHistory: [],
  evaluation: null,
  isAgentTyping: false,
  chatClosed: false,
  purchaseState: 'idle',
  testMode: true,

  setTestMode: (testMode) => set({ testMode }),

  applySettings: (settings) => set({ intensity: settings.intensity }),

  openIntercept: (item) =>
    set({
      isOpen: true,
      verdictStatus: 'negotiating',
      cartItemName: item.name,
      cartItemPrice: item.price,
      cartItemImage: item.imageUrl,
      evaluation: null,
      finances: null,
      financesError: item.price === null ? 'No price to score.' : null,
      isAgentTyping: false,
      chatClosed: false,
      purchaseState: 'idle',
      chatHistory: [
        {
          id: makeId(),
          role: 'agent',
          content:
            item.price === null
              ? "I couldn't read the price on this checkout page, so I can't score this purchase. The checkout stays paused."
              : pendingMessage(get(), item),
        },
      ],
    }),

  // The server's deterministic score replaces the pending message once it arrives, and its snapshot fills the
  // charts so they show the numbers the score used.
  applyEvaluation: (e) =>
    set({
      finances: fromSnapshot(e.snapshot),
      dataSource: e.snapshot.source,
      evaluation: e,
      // Under the threshold ('inform') the overlay still opens, but as a green light rather than a debate.
      verdictStatus: VERDICT_FOR_ACTION[e.action],
      // The score stays internal (it only decides the verdict); the user sees the explanation alone.
      chatHistory: [{ id: makeId(), role: 'agent', content: e.message }],
    }),

  // The checkout stays locked: with no score there is nothing to approve.
  failEvaluation: () =>
    set({
      financesError: "Couldn't load your bank data.",
      chatHistory: [
        {
          id: makeId(),
          role: 'agent',
          content: "I couldn't reach your bank data, so I can't score this purchase. The checkout stays paused.",
        },
      ],
    }),

  // SIMULATED: logs the purchase on the server so the ledger and next score reflect it. The checkout click
  // stays blocked, so no Amazon order is placed.
  simulatePurchase: async () => {
    const { evaluation, purchaseState, cartItemName, cartItemPrice, pushMessage } = get()
    if (!evaluation || cartItemPrice === null || purchaseState !== 'idle') return
    set({ purchaseState: 'saving' })
    try {
      const res = await callServer<{ snapshot: ServerSnapshot }>({
        type: 'purchase',
        purchase: { title: cartItemName, price: cartItemPrice },
      })
      set({ finances: fromSnapshot(res.snapshot), dataSource: res.snapshot.source, purchaseState: 'done' })
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
    const { evaluation, isAgentTyping, chatClosed, cartItemName, cartItemPrice, pushMessage } = get()
    if (!evaluation || cartItemPrice === null || isAgentTyping || chatClosed) return
    pushMessage('user', text)
    set({ isAgentTyping: true })
    const history = get().chatHistory.map((m) => ({
      role: m.role === 'agent' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }))
    try {
      const res = await callServer<{ reply: string; done: boolean }>({
        type: 'chat',
        purchase: { title: cartItemName, price: cartItemPrice },
        history,
      })
      pushMessage('agent', res.reply)
      if (res.done) set({ chatClosed: true })
    } catch {
      pushMessage('agent', "I couldn't reach the server. Nothing about this order has changed.")
    } finally {
      set({ isAgentTyping: false })
    }
  },

  close: () => set({ isOpen: false, verdictStatus: 'idle' }),
}))
