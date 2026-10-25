import { create } from 'zustand'
import { callServer, type CustomerOption, type ServerProfile } from '../api'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Intensity, type LinkedAccount, type Settings } from '../settings'

// The popup is its own page (separate JS context from the content script), so it gets its own store.
// Edits live in `draft` until "Save & Activate" writes the finances to the bank (Nessie, via the server)
// and persists what the bank then holds to chrome.storage.

type Draft = Omit<Settings, 'active'>

export type Section = 'account' | 'finances' | 'agent'

interface PopupState {
  status: 'loading' | 'ready'
  section: Section
  saved: Settings
  draft: Draft
  saving: boolean
  justSaved: boolean
  saveError: string | null
  switchingCustomer: boolean

  hydrate: () => Promise<void>
  setSection: (section: Section) => void
  linkAccount: (account: LinkedAccount) => Promise<void>
  unlinkAccount: () => void
  setIncome: (value: number) => void
  setFixedBills: (value: number) => void
  setSavings: (value: number) => void
  setDiscretionary: (value: number) => void
  setIntensity: (intensity: Intensity) => void
  save: () => Promise<void>
  setActive: (active: boolean) => Promise<void>
  switchCustomer: (customerId: string) => Promise<void>
}

// Allocation math runs in whole cents so float drift can't make a balanced split read as unbalanced.
const toCents = (n: number) => Math.round(n * 100)
const fromCents = (c: number) => c / 100

// Discretionary absorbs whatever income is left after fixed bills and savings.
function autoDiscretionary(d: Draft): Draft {
  return { ...d, discretionary: fromCents(Math.max(toCents(d.monthlyIncome) - toCents(d.fixedBills) - toCents(d.savings), 0)) }
}

const toDraft = ({ active: _active, ...draft }: Settings): Draft => draft
const EMPTY_DRAFT = toDraft(DEFAULT_SETTINGS)

// The config as the server holds it for the current customer: finances from Nessie (discretionary is derived
// server-side, so it always balances) plus the intensity, which is kept per customer.
const fromProfile = (p: ServerProfile) => ({
  account: p.account,
  monthlyIncome: p.monthly_income,
  fixedBills: p.fixed_bills,
  savings: p.savings,
  discretionary: p.discretionary,
  intensity: p.intensity,
})

// No accountId = the current customer's linked account.
const fetchProfile = (accountId?: string) => callServer<ServerProfile>({ type: 'getProfile', accountId })

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

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

export const usePopupStore = create<PopupState>((set, get) => {
  // Every draft edit clears a stale save error.
  const edit = (change: (d: Draft) => Draft) => set((s) => ({ draft: change(s.draft), saveError: null }))

  return {
    status: 'loading',
    section: 'account',
    saved: DEFAULT_SETTINGS,
    draft: EMPTY_DRAFT,
    saving: false,
    justSaved: false,
    saveError: null,
    switchingCustomer: false,

    hydrate: async () => {
      const stored = await loadSettings()
      set({ status: 'ready', saved: stored, draft: toDraft(stored) })
      // Open on the first section that still needs attention.
      set({ section: selectSaveBlocker(get())?.section ?? 'account' })

      // The server is the source of truth: show what it holds for the current customer now (e.g. after a demo
      // reset or a customer switch), not what this browser saved last time. If the server is down, the last
      // saved values stay.
      if (!stored.account) return
      try {
        const saved: Settings = { ...get().saved, ...fromProfile(await fetchProfile()) }
        set((s) => ({ saved, draft: selectIsDirty(s) ? s.draft : toDraft(saved) }))
        if (JSON.stringify(saved) !== JSON.stringify(stored)) await saveSettings(saved)
      } catch {
        // Offline: keep showing the stored copy.
      }
    },

    setSection: (section) => set({ section }),

    linkAccount: async (account) => {
      edit((d) => ({ ...d, account }))
      // Prefill an empty Finances tab with what the bank already holds for this account.
      if (get().draft.monthlyIncome > 0) return
      try {
        const profile = await fetchProfile(account.id)
        const { draft } = get()
        if (profile.monthly_income > 0 && draft.account?.id === account.id && draft.monthlyIncome === 0) {
          edit((d) => ({ ...d, ...fromProfile(profile) }))
        }
      } catch {
        // Nothing to prefill; the user types their numbers in.
      }
    },
    unlinkAccount: () => edit((d) => ({ ...d, account: null })),

    setIncome: (monthlyIncome) => edit((d) => autoDiscretionary({ ...d, monthlyIncome })),
    setFixedBills: (fixedBills) => edit((d) => autoDiscretionary({ ...d, fixedBills })),
    setSavings: (savings) => edit((d) => autoDiscretionary({ ...d, savings })),
    // A manual discretionary override rebalances savings; fixed bills are real obligations, so they never move.
    setDiscretionary: (discretionary) =>
      edit((d) => {
        const savingsCents = toCents(d.monthlyIncome) - toCents(d.fixedBills) - toCents(discretionary)
        return { ...d, discretionary, savings: fromCents(Math.max(savingsCents, 0)) }
      }),

    setIntensity: (intensity) => edit((d) => ({ ...d, intensity })),

    save: async () => {
      const { draft } = get()
      if (selectSaveBlocker(get()) || !draft.account) return
      set({ saving: true, saveError: null })
      try {
        const profile = await callServer<ServerProfile>({
          type: 'saveProfile',
          profile: {
            account_id: draft.account.id,
            monthly_income: draft.monthlyIncome,
            fixed_bills: draft.fixedBills,
            savings: draft.savings,
            discretionary: draft.discretionary,
            intensity: draft.intensity,
          },
        })
        // Store what the bank now holds, so this browser and Nessie can't disagree.
        const settings: Settings = { ...draft, ...fromProfile(profile), active: true }
        await saveSettings(settings)
        set({ saved: settings, draft: toDraft(settings), justSaved: true })
        setTimeout(() => set({ justSaved: false }), 2500)
      } catch (err) {
        set({ saveError: `Couldn't save to your bank: ${errorText(err)}` })
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

    // Dev/demo control: point the server at another Nessie customer and load their saved config.
    switchCustomer: async (customerId) => {
      set({ switchingCustomer: true, saveError: null })
      try {
        const res = await callServer<{ customer: CustomerOption; profile: ServerProfile }>({
          type: 'selectCustomer',
          customerId,
        })
        const saved: Settings = { ...get().saved, ...fromProfile(res.profile) }
        await saveSettings(saved)
        set({ saved, draft: toDraft(saved), justSaved: false })
      } catch (err) {
        set({ saveError: `Couldn't switch customer: ${errorText(err)}` })
      } finally {
        set({ switchingCustomer: false })
      }
    },
  }
})
