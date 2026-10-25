import { create } from 'zustand'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Intensity, type LinkedAccount, type Settings } from '../settings'

// The popup is its own page (separate JS context from the content script), so it gets its own store.
// Edits live in `draft` until "Save & Activate" persists them to chrome.storage.

type Draft = Omit<Settings, 'active'>

export type Section = 'account' | 'finances' | 'agent'

interface PopupState {
  status: 'loading' | 'ready'
  section: Section
  saved: Settings
  draft: Draft
  saving: boolean
  justSaved: boolean

  hydrate: () => Promise<void>
  setSection: (section: Section) => void
  linkAccount: (account: LinkedAccount) => void
  unlinkAccount: () => void
  setIncome: (value: number) => void
  setFixedBills: (value: number) => void
  setSavings: (value: number) => void
  setDiscretionary: (value: number) => void
  setIntensity: (intensity: Intensity) => void
  save: () => Promise<void>
  setActive: (active: boolean) => Promise<void>
}

// Allocation math runs in whole cents so float drift can't make a balanced split read as unbalanced.
const toCents = (n: number) => Math.round(n * 100)
const fromCents = (c: number) => c / 100

// Discretionary absorbs whatever income is left after fixed bills and savings.
function autoDiscretionary(d: Draft): Draft {
  return { ...d, discretionary: fromCents(Math.max(toCents(d.monthlyIncome) - toCents(d.fixedBills) - toCents(d.savings), 0)) }
}

const { active: _active, ...EMPTY_DRAFT } = DEFAULT_SETTINGS

function allocationOf({ monthlyIncome, fixedBills, savings, discretionary }: Draft) {
  const allocatedCents = toCents(fixedBills) + toCents(savings) + toCents(discretionary)
  const diffCents = allocatedCents - toCents(monthlyIncome)
  return {
    allocated: fromCents(allocatedCents),
    overBy: fromCents(Math.max(diffCents, 0)),
    unallocated: fromCents(Math.max(-diffCents, 0)),
    isBalanced: monthlyIncome > 0 && diffCents === 0,
  }
}

export const selectAllocation = (s: PopupState) => allocationOf(s.draft)

// The Enabled switch acts on the *saved* configuration, so it's only usable once a complete setup has been saved.
export const selectCanEnable = (s: PopupState) => s.saved.account !== null && allocationOf(s.saved).isBalanced

export const selectIsDirty = (s: PopupState) =>
  (Object.keys(s.draft) as (keyof Draft)[]).some((k) => JSON.stringify(s.draft[k]) !== JSON.stringify(s.saved[k]))

export const selectSectionComplete = (s: PopupState, section: Section) => {
  if (section === 'account') return s.draft.account !== null
  if (section === 'finances') return selectAllocation(s).isBalanced
  return true // intensity always has a value (defaults to medium)
}

export interface SaveBlocker {
  message: string
  section: Section
}

// Returns a stable reference per reason so it can be used directly as a Zustand selector.
const BLOCKERS = {
  account: { message: 'Connect a bank account to continue.', section: 'account' },
  income: { message: 'Enter your monthly net income.', section: 'finances' },
  balance: { message: 'Fixed bills, savings and discretionary must add up to 100% of income.', section: 'finances' },
} satisfies Record<string, SaveBlocker>

export const selectSaveBlocker = (s: PopupState): SaveBlocker | null => {
  if (!s.draft.account) return BLOCKERS.account
  if (s.draft.monthlyIncome <= 0) return BLOCKERS.income
  if (!selectAllocation(s).isBalanced) return BLOCKERS.balance
  return null
}

export const usePopupStore = create<PopupState>((set, get) => ({
  status: 'loading',
  section: 'account',
  saved: DEFAULT_SETTINGS,
  draft: EMPTY_DRAFT,
  saving: false,
  justSaved: false,

  hydrate: async () => {
    const saved = await loadSettings()
    const { active: _ignored, ...draft } = saved
    set({ status: 'ready', saved, draft })
    // Open on the first section that still needs attention.
    set({ section: selectSaveBlocker(get())?.section ?? 'account' })
  },

  setSection: (section) => set({ section }),

  linkAccount: (account) => set((s) => ({ draft: { ...s.draft, account } })),
  unlinkAccount: () => set((s) => ({ draft: { ...s.draft, account: null } })),

  setIncome: (monthlyIncome) => set((s) => ({ draft: autoDiscretionary({ ...s.draft, monthlyIncome }) })),
  setFixedBills: (fixedBills) => set((s) => ({ draft: autoDiscretionary({ ...s.draft, fixedBills }) })),
  setSavings: (savings) => set((s) => ({ draft: autoDiscretionary({ ...s.draft, savings }) })),
  // A manual discretionary override rebalances savings; fixed bills are real obligations, so they never move.
  setDiscretionary: (discretionary) =>
    set((s) => {
      const savingsCents = toCents(s.draft.monthlyIncome) - toCents(s.draft.fixedBills) - toCents(discretionary)
      return { draft: { ...s.draft, discretionary, savings: fromCents(Math.max(savingsCents, 0)) } }
    }),

  setIntensity: (intensity) => set((s) => ({ draft: { ...s.draft, intensity } })),

  save: async () => {
    if (selectSaveBlocker(get())) return
    const settings: Settings = { ...get().draft, active: true }
    set({ saving: true })
    try {
      await saveSettings(settings)
      set({ saved: settings, justSaved: true })
      setTimeout(() => set({ justSaved: false }), 2500)
    } finally {
      set({ saving: false })
    }
  },

  // Flips only the persisted `active` flag; unsaved draft edits are left untouched.
  setActive: async (active) => {
    if (active && !selectCanEnable(get())) return
    const settings: Settings = { ...get().saved, active }
    await saveSettings(settings)
    // Clear any lingering "Interceptor active" flash so the save bar can't contradict the switch.
    set({ saved: settings, justSaved: false })
  },
}))
