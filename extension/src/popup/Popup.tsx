import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Landmark, LoaderCircle, Scale, Wallet, type LucideIcon } from 'lucide-react'
import AccountCard from './components/AccountCard'
import BaselineCard from './components/BaselineCard'
import ConnectBankModal from './components/ConnectBankModal'
import EnableSwitch from './components/EnableSwitch'
import InterventionCard from './components/InterventionCard'
import TestModeSwitch from './components/TestModeSwitch'
import { selectCanEnable, selectIsDirty, selectSaveBlocker, selectSectionComplete, usePopupStore, type Section } from './store'

const SECTIONS: { id: Section; label: string; Icon: LucideIcon }[] = [
  { id: 'account', label: 'Account', Icon: Landmark },
  { id: 'finances', label: 'Finances', Icon: Wallet },
  { id: 'agent', label: 'Agent', Icon: Scale },
]

function SectionTab({ id, label, Icon, index }: (typeof SECTIONS)[number] & { index: number }) {
  const isSelected = usePopupStore((s) => s.section === id)
  const isComplete = usePopupStore((s) => selectSectionComplete(s, id))
  const setSection = usePopupStore((s) => s.setSection)

  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={isSelected}
      aria-controls={`panel-${id}`}
      tabIndex={isSelected ? 0 : -1}
      onClick={() => setSection(id)}
      className={`relative flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${
        isSelected ? 'bg-panel text-zinc-100 shadow ring-1 ring-zinc-700' : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      <span className="text-[10px] tabular-nums text-zinc-500">{index + 1}</span>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
      {isComplete ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-label="complete" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="needs attention" />
      )}
    </button>
  )
}

function SectionTabs() {
  const section = usePopupStore((s) => s.section)
  const setSection = usePopupStore((s) => s.setSection)
  const listRef = useRef<HTMLDivElement>(null)

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const current = SECTIONS.findIndex((s) => s.id === section)
    const next = SECTIONS[(current + (e.key === 'ArrowRight' ? 1 : SECTIONS.length - 1)) % SECTIONS.length]
    setSection(next.id)
    listRef.current?.querySelector<HTMLButtonElement>(`#tab-${next.id}`)?.focus()
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Configuration sections"
      onKeyDown={onKeyDown}
      className="mx-5 grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1"
    >
      {SECTIONS.map((s, i) => (
        <SectionTab key={s.id} {...s} index={i} />
      ))}
    </div>
  )
}

function SaveBar() {
  const blocker = usePopupStore(selectSaveBlocker)
  const isDirty = usePopupStore(selectIsDirty)
  const isActive = usePopupStore((s) => s.saved.active)
  const section = usePopupStore((s) => s.section)
  const saving = usePopupStore((s) => s.saving)
  const justSaved = usePopupStore((s) => s.justSaved)
  const saveError = usePopupStore((s) => s.saveError)
  const canEnable = usePopupStore(selectCanEnable)
  const save = usePopupStore((s) => s.save)
  const setSection = usePopupStore((s) => s.setSection)

  const nothingToSave = isActive && !isDirty
  const disabled = Boolean(blocker) || saving || nothingToSave

  return (
    <footer className="border-t border-zinc-800 bg-base px-5 pb-2.5 pt-3">
      <button
        type="button"
        onClick={save}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition-opacity hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-500"
      >
        {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
        {justSaved && <CheckCircle2 className="h-4 w-4" aria-hidden />}
        {justSaved ? 'Interceptor active' : isActive ? 'Save Changes' : 'Save & Activate Interceptor'}
      </button>
      <p className="mt-1.5 min-h-[1rem] text-center text-[11px] text-zinc-400" aria-live="polite">
        {saveError ? (
          <span className="text-red-300" role="alert">
            {saveError}
          </span>
        ) : blocker ? (
          blocker.section === section ? (
            blocker.message
          ) : (
            // The blocking field is on another tab, so the hint doubles as a shortcut to it.
            <button type="button" onClick={() => setSection(blocker.section)} className="underline-offset-2 hover:text-zinc-100 hover:underline">
              {blocker.message} →
            </button>
          )
        ) : nothingToSave && !justSaved ? (
          'Watching Checkout. Edit a setting to update it.'
        ) : !isActive && canEnable && !isDirty ? (
          <span className="text-red-300">Interceptor disabled. Checkouts go through without review.</span>
        ) : null}
      </p>
    </footer>
  )
}

export default function Popup() {
  const status = usePopupStore((s) => s.status)
  const section = usePopupStore((s) => s.section)
  const hydrate = usePopupStore((s) => s.hydrate)
  const linkAccount = usePopupStore((s) => s.linkAccount)
  const setSection = usePopupStore((s) => s.setSection)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  return (
    <div className="relative flex h-[600px] w-[440px] flex-col bg-base font-sans text-zinc-100">
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-3.5">
        <div>
          <h1 className="text-base font-semibold text-white">Devil's Advocate Configuration</h1>
          <p className="mt-0.5 text-[11px] text-zinc-400">Establish your financial baseline so the agent can keep you honest.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <EnableSwitch />
          <TestModeSwitch />
        </div>
      </header>

      {status === 'loading' ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-400">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading settings…
        </div>
      ) : (
        <>
          <SectionTabs />
          <main
            role="tabpanel"
            id={`panel-${section}`}
            aria-labelledby={`tab-${section}`}
            className="min-h-0 flex-1 overflow-y-auto px-5 py-3"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={section}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                {section === 'account' && <AccountCard onConnect={() => setConnecting(true)} />}
                {section === 'finances' && <BaselineCard />}
                {section === 'agent' && <InterventionCard />}
              </motion.div>
            </AnimatePresence>
          </main>
        </>
      )}

      <SaveBar />

      {connecting && (
        <ConnectBankModal
          onClose={() => setConnecting(false)}
          onLinked={(account) => {
            linkAccount(account)
            setConnecting(false)
            // First-time setup flows straight on to the next step.
            if (!usePopupStore.getState().saved.active) setSection('finances')
          }}
        />
      )}
    </div>
  )
}
