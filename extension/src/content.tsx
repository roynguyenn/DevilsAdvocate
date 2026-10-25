import { createRoot } from 'react-dom/client'
import App from './App'
import { callServer } from './api'
import styles from './index.css?inline'
import { loadSettings, loadTestMode, onSettingsChanged, onTestModeChanged, type Settings } from './settings'
import { useInterceptorStore, type Evaluation, type InterceptedItem } from './store'

const HOST_ID = 'devils-advocate-host'

// "Place your order" only — never Add to Cart (CLAUDE.md Rule 3).
const CHECKOUT_SELECTORS = [
  '#placeYourOrder1',
  '#submitOrderButtonId',
  '#bottomSubmitOrderButtonId',
  'input[name="placeYourOrder1"]',
].join(',')

function mountOverlay() {
  if (document.getElementById(HOST_ID)) return

  const host = document.createElement('div')
  host.id = HOST_ID
  // Stop Amazon's inherited properties (font, color, line-height) from crossing the shadow boundary.
  host.style.all = 'initial'
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.appendChild(style)

  const container = document.createElement('div')
  shadow.appendChild(container)
  createRoot(container).render(<App />)
}

const parsePrice = (text: string | null | undefined) => {
  const n = parseFloat((text ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

const firstText = (selectors: string[]) => {
  for (const sel of selectors) {
    const text = document.querySelector(sel)?.textContent?.trim()
    if (text) return text
  }
  return null
}

// Only https URLs: the src is page-controlled and gets rendered inside our overlay.
const firstImage = (selectors: string[]) => {
  for (const sel of selectors) {
    const src = document.querySelector<HTMLImageElement>(sel)?.src
    if (src?.startsWith('https://')) return src
  }
  return null
}

// Best-effort scrape of the checkout page; falls back to the store's mock item when Amazon's markup shifts.
function scrapeCheckout(): InterceptedItem {
  const fallback = useInterceptorStore.getState()
  const name = firstText([
    '.lineitem-title-text',
    '[data-csa-c-content-id*="item-title"]',
    '.item-title',
    '.a-row.breakword .a-text-bold',
  ])
  const price = parsePrice(
    firstText(['.grand-total-price', '#subtotals-marketplace-table .a-color-price', '.order-summary-grand-total .a-text-right']),
  )
  return {
    name: name ?? fallback.cartItemName,
    price: price ?? fallback.cartItemPrice,
    imageUrl: firstImage(['.lineitem-image img', '[data-csa-c-content-id*="item-image"] img', '.item-image img']),
  }
}

// null until chrome.storage answers. Treated as active so a click during startup is still caught (fail closed).
let interceptorActive: boolean | null = null
// Starts true for the same reason: until storage says otherwise, assume we're testing and block orders.
let testMode = true

// Testing mode also catches order buttons CHECKOUT_SELECTORS misses, matched by their visible label, so a
// changed Amazon layout can't slip a real order through while developing.
const ORDER_LABEL = /\b(place (your )?order|buy now|submit (your )?order|complete (your )?(order|purchase)|pay now)\b/i
const CLICKABLE = 'button, input[type="submit"], input[type="button"], [role="button"], a'

function looksLikeOrderControl(el: Element | null): boolean {
  const control = el?.closest?.(CLICKABLE)
  if (!control) return false
  // Amazon's button text is full of newlines and runs of spaces ("Place\n   your order"); collapse them first.
  const label = [control.textContent, control.getAttribute('value'), control.getAttribute('aria-label')]
    .join(' ')
    .replace(/\s+/g, ' ')
  return ORDER_LABEL.test(label)
}

const isOrderControl = (el: Element | null) =>
  Boolean(el?.closest?.(CHECKOUT_SELECTORS)) || (testMode && looksLikeOrderControl(el))

function applySettings(settings: Settings) {
  interceptorActive = settings.active
  if (settings.active) useInterceptorStore.getState().applySettings(settings)
}

function applyTestMode(on: boolean) {
  testMode = on
  useInterceptorStore.getState().setTestMode(on)
}

function intercept(e: Event) {
  // A paused interceptor lets orders through, except in testing mode, where nothing is ever ordered.
  if (interceptorActive === false && !testMode) return
  e.preventDefault()
  e.stopImmediatePropagation()
  const item = scrapeCheckout()
  useInterceptorStore.getState().openIntercept(item)
  requestEvaluation(item)
}

// If the server is down the overlay keeps the mock message, so the lock still holds.
function requestEvaluation(item: InterceptedItem) {
  callServer<Evaluation>({ type: 'evaluate', purchase: { title: item.name, price: item.price } })
    .then((e) => useInterceptorStore.getState().applyEvaluation(e))
    .catch((err: Error) => console.warn('[devils-advocate] evaluate failed:', err.message))
}

// Capture-phase delegation on window: runs before Amazon's own handlers and survives the
// button being re-rendered (address/payment changes swap out the checkout DOM).
function onClick(e: MouseEvent) {
  if (isOrderControl(e.target as Element | null)) intercept(e)
}

// Catches keyboard submission (Enter) of the order form, which never fires a click on the button. A submit with
// no submitter (form.submit() from script) is caught in testing mode if the form holds an order button.
function onSubmit(e: SubmitEvent) {
  const form = e.target as HTMLFormElement | null
  const formHasOrderButton = Boolean(form?.querySelector?.(CHECKOUT_SELECTORS)) ||
    Array.from(form?.querySelectorAll?.(CLICKABLE) ?? []).some((el) => looksLikeOrderControl(el))
  if (isOrderControl(e.submitter) || (testMode && !e.submitter && formHasOrderButton)) intercept(e)
}

function init() {
  loadSettings().then(applySettings, () => {
    // Storage unreadable: keep intercepting with mock data rather than letting the order through.
    interceptorActive = true
  })
  onSettingsChanged(applySettings)
  loadTestMode().then(applyTestMode, () => applyTestMode(true))
  onTestModeChanged(applyTestMode)
  mountOverlay()
  window.addEventListener('click', onClick, true)
  window.addEventListener('submit', onSubmit, true)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true })
} else {
  init()
}
