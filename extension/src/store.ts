import { create } from 'zustand'
import { callServer, type DecisionOutcome } from './api'
import { formatUsd } from './format'
import type { Intensity, Settings } from './settings'

export type VerdictStatus = 'idle' | 'negotiating' | 'blocked' | 'approved'

export interface ChatMessage {
  id: string
  role: 'agent' | 'user'
  content: string
}

export interface CartItem {
  name: string
  // Unit price as shown on the line item; null when that line has no readable price.
  price: number | null
  quantity: number
  imageUrl: string | null
}

export interface InterceptedCart {
  items: CartItem[]
  // What gets scored: the order total with shipping and tax, or the item subtotal when the page shows no
  // order total. null when the page has no readable price; we never substitute a made-up one.
  total: number | null
  totalIncludesShippingAndTax: boolean
}

const MAX_TITLE_LENGTH = 480 // the server caps titles at 500

// One title for the server (score, chat, simulated purchase), naming every item: "2× Charger; Standing Desk".
export function cartTitle(items: CartItem[]) {
  const title = items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join('; ')
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title
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
  | { type: 'manual' } // no bank linked: Finances tab + purchases made through the extension
  | { type: 'nessie'; customer_id: string; account_id: string; customer_name: string }

// What the server's charts data looks like (server/app.py _snapshot_for_ui), all read from Nessie.
export interface ServerSnapshot {
  monthly_income: number
  monthly_bills: number
  savings: number
  // Discretionary budget: income - fixed bills - savings.
  budget: number
  spent_this_month: number
  // null when no bank is linked.
  balance: number | null
  transactions: Transaction[]
  source: DataSource
}

// Shape returned by the server's POST /evaluate. The score is a hidden heuristic: kept here for the overlay's
// logic, never rendered, and never sent to Claude.
export interface Evaluation {
  action: 'inform' | 'nudge' | 'block'
  score_before: number
  score_after: number
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

  cart: CartItem[]
  cartTotal: number | null
  cartTotalIsFinal: boolean

  isOpen: boolean
  verdictStatus: VerdictStatus
  chatHistory: ChatMessage[]
  evaluation: Evaluation | null
  isAgentTyping: boolean
  // Set when the server wraps the chat up. The reply cap lives only on the server and is never shown.
  chatClosed: boolean
  // One decision-log entry per checkout: bought, or left_checkout (left without buying; may still be deciding).
  decisionLogged: boolean
  // Shown briefly after the overlay is gone, e.g. "Logged $24.99 as a purchase. Nothing was ordered."
  notice: string | null
  // Waiting on the server after the first click; the overlay only opens if the score flags the purchase.
  checking: boolean
  // The agent is the judge once the overlay is open: it starts false and Claude can approve in chat.
  agentApproved: boolean
  // Mirrors the popup's Testing switch (settings.ts) so the overlay can say no order will be placed.
  testMode: boolean

  applySettings: (settings: Settings) => void
  setTestMode: (on: boolean) => void
  openIntercept: (cart: InterceptedCart) => void
  applyEvaluation: (e: Evaluation) => void
  failEvaluation: () => void
  pushMessage: (role: ChatMessage['role'], content: string) => void
  sendChat: (text: string) => Promise<void>
  // Score said it's fine: no overlay; record it as a purchase (the content script releases it in Live mode).
  approveSilently: (e: Evaluation) => Promise<void>
  confirmPurchase: (notice?: string) => Promise<void>
  showNotice: (text: string) => void
  logDecision: (outcome: DecisionOutcome) => void
  close: () => void
}

const makeId = () => Math.random().toString(36).slice(2, 10)

const NOTICE_MS = 4000

const CLOSING_LINE: Record<Intensity, string> = {
  light: 'Are you sure you want this?',
  medium: 'Defend this purchase.',
  harsh: "That's money you promised to your savings goal. Convince me, and make it good.",
}

// Shown until the server's score arrives. No numbers: every figure on screen comes from the server.
function pendingMessage(s: InterceptorState, cart: InterceptedCart) {
  const what = cart.items.length === 1 ? `"${cart.items[0].name}"` : `these ${cart.items.length} items`
  return `Checking ${what} against your accounts… ${CLOSING_LINE[s.intensity]}`
}

export const useInterceptorStore = create<InterceptorState>((set, get) => ({
  finances: null,
  financesError: null,
  intensity: 'medium',
  dataSource: null,

  cart: [],
  cartTotal: null,
  cartTotalIsFinal: false,

  isOpen: false,
  verdictStatus: 'idle',
  chatHistory: [],
  evaluation: null,
  isAgentTyping: false,
  chatClosed: false,
  decisionLogged: false,
  notice: null,
  checking: false,
  agentApproved: false,
  testMode: true,

  setTestMode: (testMode) => set({ testMode }),

  applySettings: (settings) => set({ intensity: settings.intensity }),

  // First click: hold the order and wait for the score. The overlay opens only if the score flags it (or there's
  // no price to score); a fine score never shows it.
  openIntercept: (cart) =>
    set({
      isOpen: cart.total === null,
      checking: cart.total !== null,
      agentApproved: false,
      verdictStatus: 'negotiating',
      cart: cart.items,
      cartTotal: cart.total,
      cartTotalIsFinal: cart.totalIncludesShippingAndTax,
      evaluation: null,
      finances: null,
      financesError: cart.total === null ? 'No price to score.' : null,
      isAgentTyping: false,
      chatClosed: false,
      decisionLogged: false,
      notice: null,
      chatHistory: [
        {
          id: makeId(),
          role: 'agent',
          content:
            cart.total === null
              ? "I couldn't read the price on this checkout page, so I can't score this purchase. The checkout stays paused."
              : pendingMessage(get(), cart),
        },
      ],
    }),

  // The server's deterministic score replaces the pending message once it arrives, and its snapshot fills the
  // charts so they show the numbers the score used.
  // The score flagged it: open the overlay. The order starts not approved; the agent judges from here (sendChat).
  applyEvaluation: (e) =>
    set({
      isOpen: true,
      checking: false,
      agentApproved: false,
      finances: fromSnapshot(e.snapshot),
      dataSource: e.snapshot.source,
      evaluation: e,
      verdictStatus: VERDICT_FOR_ACTION[e.action],
      // The score stays internal (it only decides the verdict); the user sees the explanation alone.
      chatHistory: [{ id: makeId(), role: 'agent', content: e.message }],
    }),

  // The checkout stays locked: with no score there is nothing to approve.
  failEvaluation: () =>
    set({
      isOpen: true,
      checking: false,
      financesError: "Couldn't load your bank data.",
      chatHistory: [
        {
          id: makeId(),
          role: 'agent',
          content: "I couldn't reach your bank data, so I can't score this purchase. The checkout stays paused.",
        },
      ],
    }),

  // The student closed the overlay and clicked Place your order again for the same cart: that's their decision
  // to buy. The purchase is recorded (Nessie or the Finances-tab log) and logged as "bought". In testing mode the
  // content script has already blocked the click, so nothing is ordered; in Live mode the click went on to Amazon.
  approveSilently: async (e) => {
    set({
      checking: false,
      agentApproved: true, // approved by the score itself
      evaluation: e,
      finances: fromSnapshot(e.snapshot),
      dataSource: e.snapshot.source,
    })
    await get().confirmPurchase('Looks fine to buy.')
  },

  // Buying: either a fine score (approveSilently) or the second Place Order click after the overlay. It's always
  // allowed; without the agent's approval it's logged as "bought_unapproved".
  confirmPurchase: async (notice) => {
    const { evaluation, decisionLogged, cart, cartTotal, testMode, agentApproved } = get()
    if (!evaluation || decisionLogged || cartTotal === null) return
    get().logDecision(agentApproved ? 'bought' : 'bought_unapproved')
    try {
      const res = await callServer<{ snapshot: ServerSnapshot }>({
        type: 'purchase',
        purchase: { title: cartTitle(cart), price: cartTotal, simulated: testMode },
      })
      set({ finances: fromSnapshot(res.snapshot), dataSource: res.snapshot.source })
      if (testMode) {
        const logged = `Logged ${formatUsd(cartTotal)} as a purchase. Nothing was ordered (testing mode).`
        get().showNotice(notice ? `${notice} ${logged}` : logged)
      }
    } catch {
      get().showNotice("Couldn't reach the server, so this purchase wasn't added to your transactions.")
    }
  },

  showNotice: (text) => {
    set({ notice: text })
    setTimeout(() => {
      if (get().notice === text) set({ notice: null })
    }, NOTICE_MS)
  },

  pushMessage: (role, content) =>
    set((s) => ({ chatHistory: [...s.chatHistory, { id: makeId(), role, content }] })),

  // Chat can explain the verdict but never change it: the reply is text only, and the verdict stays as evaluated.
  sendChat: async (text) => {
    const { evaluation, isAgentTyping, chatClosed, cart, cartTotal, pushMessage } = get()
    if (!evaluation || cartTotal === null || isAgentTyping || chatClosed) return
    pushMessage('user', text)
    set({ isAgentTyping: true })
    const history = get().chatHistory.map((m) => ({
      role: m.role === 'agent' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }))
    try {
      const res = await callServer<{ reply: string; done: boolean; approved: boolean }>({
        type: 'chat',
        purchase: { title: cartTitle(cart), price: cartTotal },
        history,
      })
      pushMessage('agent', res.reply)
      if (res.approved && !get().agentApproved) set({ agentApproved: true, verdictStatus: 'approved' })
      if (res.done) set({ chatClosed: true })
    } catch {
      pushMessage('agent', "I couldn't reach the server. Nothing about this order has changed.")
    } finally {
      set({ isAgentTyping: false })
    }
  },

  // Fire-and-forget: the server summarizes the chat (Claude) into a 1-2 line memory for next time.
  logDecision: (outcome) => {
    const { evaluation, decisionLogged, cart, cartTotal, chatHistory } = get()
    if (!evaluation || decisionLogged || cartTotal === null) return
    set({ decisionLogged: true })
    const history = chatHistory.slice(-20).map((m) => ({
      role: m.role === 'agent' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }))
    callServer({ type: 'decision', purchase: { title: cartTitle(cart), price: cartTotal }, history, outcome }).catch(
      (err: Error) => console.warn('[devils-advocate] decision not logged:', err.message),
    )
  },

  // Closing just returns to the checkout page; the decision is still open. Clicking Place your order again buys
  // (confirmPurchase); leaving the page or checking out a different cart logs "left_checkout" (content.tsx).
  close: () => set({ isOpen: false, verdictStatus: 'idle' }),
}))
