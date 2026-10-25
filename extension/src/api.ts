import type { Intensity, LinkedAccount } from './settings'

export interface Purchase {
  title: string
  price: number
  category?: string
  // /purchase only: false when the student is placing the real order (Live mode).
  simulated?: boolean
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

// The popup's config as the server saves it (PUT /profile). account_id null = no bank linked: the Finances tab
// alone is used, stored on our server.
export interface ProfileInput {
  account_id: string | null
  monthly_income: number
  fixed_bills: number
  savings: number
  discretionary: number
  // Saved per customer on the server (not a bank field).
  intensity?: Intensity
}

// What Nessie holds after a read or write (GET|PUT /profile).
export interface ServerProfile {
  // null when no bank is linked (Finances tab only).
  account: LinkedAccount | null
  monthly_income: number
  fixed_bills: number
  savings: number
  discretionary: number
  intensity: Intensity
}

// A Nessie customer the dev dropdown can switch to (GET /customers).
export interface CustomerOption {
  id: string
  name: string
}

export interface CustomerList {
  current: string
  customers: CustomerOption[]
}

// left_checkout = left without buying: they may still be deciding, so it isn't a "no".
// bought_unapproved = they bought without the agent's approval (always allowed, but noted).
export type DecisionOutcome = 'bought' | 'bought_unapproved' | 'left_checkout'

export type ServerRequest =
  | { type: 'evaluate'; purchase: Purchase }
  | { type: 'chat'; purchase: Purchase; history: ChatTurn[] }
  | { type: 'purchase'; purchase: Purchase }
  | { type: 'accounts' }
  // No accountId = the current customer's linked account.
  | { type: 'getProfile'; accountId?: string }
  | { type: 'saveProfile'; profile: ProfileInput }
  | { type: 'customers' }
  | { type: 'selectCustomer'; customerId: string }
  | { type: 'decision'; purchase: Purchase; history: ChatTurn[]; outcome: DecisionOutcome }

type ServerResponse<T> = { ok: true; data: T } | { ok: false; error: string }

// Round-trips through the service worker (background.ts), which owns every call to our server.
export function callServer<T>(msg: ServerRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res: ServerResponse<T> | undefined) => {
      if (res?.ok) resolve(res.data)
      else reject(new Error(res?.error ?? chrome.runtime.lastError?.message ?? 'no response'))
    })
  })
}
