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

export function onSettingsChanged(callback: (settings: Settings) => void) {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && STORAGE_KEY in changes) {
      callback({ ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEY].newValue as Partial<Settings> | undefined) })
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
