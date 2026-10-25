import type { Intensity, LinkedAccount } from './settings'

export interface Purchase {
  title: string
  price: number
  category?: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

// The popup's Finances tab as the server writes it to Nessie (PUT /profile).
export interface ProfileInput {
  account_id: string
  monthly_income: number
  fixed_bills: number
  savings: number
  discretionary: number
  // Saved per customer on the server (not a bank field).
  intensity?: Intensity
}

// What Nessie holds after a read or write (GET|PUT /profile).
export interface ServerProfile {
  account: LinkedAccount
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

export type DecisionOutcome = 'bought' | 'walked_away'

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
