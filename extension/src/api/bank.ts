import type { LinkedAccount } from '../settings'

// Simulated Capital One (Nessie) OAuth. The real flow runs through the backend, which holds the Nessie
// key and returns only account display metadata — the extension must never collect or store credentials.

const MOCK_ACCOUNTS: LinkedAccount[] = [
  { id: 'nessie-checking-1234', nickname: 'Checking', last4: '1234' },
  { id: 'nessie-savings-5678', nickname: 'Savings', last4: '5678' },
  { id: 'nessie-credit-9012', nickname: 'Quicksilver Credit Card', last4: '9012' },
]

const simulateLatency = <T>(value: T, ms = 700) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

export const fetchAuthorizableAccounts = () => simulateLatency(MOCK_ACCOUNTS, 500)

export const authorizeAccount = (account: LinkedAccount) => simulateLatency(account)
