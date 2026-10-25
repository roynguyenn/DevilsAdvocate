// User configuration written by the popup and read by the content script via chrome.storage.local.
// Holds no credentials: the bank link is just display metadata for an account the backend owns (Rule 2).

export type Intensity = 'light' | 'medium' | 'harsh'

export interface LinkedAccount {
  id: string
  nickname: string
  last4: string
}

export interface Settings {
  account: LinkedAccount | null
  monthlyIncome: number
  fixedBills: number
  savings: number
  discretionary: number
  intensity: Intensity
  active: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  account: null,
  monthlyIncome: 0,
  fixedBills: 0,
  savings: 0,
  discretionary: 0,
  intensity: 'medium',
  active: false,
}

// Harsh mode: discretionary purchases above this share of the budget get a forced cooling-off timer.
export const HARSH_COOLDOWN = { minutes: 5, budgetPercent: 10 }

const STORAGE_KEY = 'settings'

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] as Partial<Settings> | undefined) }
}

export const saveSettings = (settings: Settings) => chrome.storage.local.set({ [STORAGE_KEY]: settings })

// Testing mode is stored apart from Settings so it never counts as an unsaved popup edit. It defaults to ON:
// while it's on, the content script blocks every checkout order click, even when the interceptor is paused,
// setup is unfinished, or Amazon's button doesn't match CHECKOUT_SELECTORS. Nothing can be ordered.
const TEST_MODE_KEY = 'testMode'

export async function loadTestMode(): Promise<boolean> {
  const stored = await chrome.storage.local.get(TEST_MODE_KEY)
  return stored[TEST_MODE_KEY] !== false
}

export const saveTestMode = (on: boolean) => chrome.storage.local.set({ [TEST_MODE_KEY]: on })

export function onTestModeChanged(callback: (on: boolean) => void) {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && TEST_MODE_KEY in changes) callback(changes[TEST_MODE_KEY].newValue !== false)
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

export function onSettingsChanged(callback: (settings: Settings) => void) {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && STORAGE_KEY in changes) {
      callback({ ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEY].newValue as Partial<Settings> | undefined) })
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
