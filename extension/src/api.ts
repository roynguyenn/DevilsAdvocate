import type { LinkedAccount } from './settings'

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
}

// What Nessie holds after a read or write (GET|PUT /profile).
export interface ServerProfile {
  account: LinkedAccount
  monthly_income: number
  fixed_bills: number
  savings: number
  discretionary: number
}

export type ServerRequest =
  | { type: 'evaluate'; purchase: Purchase }
  | { type: 'chat'; purchase: Purchase; history: ChatTurn[] }
  | { type: 'purchase'; purchase: Purchase }
  | { type: 'accounts' }
  | { type: 'getProfile'; accountId: string }
  | { type: 'saveProfile'; profile: ProfileInput }

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
