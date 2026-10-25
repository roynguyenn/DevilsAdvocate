import { createRoot } from 'react-dom/client'
import App from './App'
import styles from './index.css?inline'
import { loadSettings, onSettingsChanged, type Settings } from './settings'
import { useInterceptorStore, type InterceptedItem } from './store'

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

function applySettings(settings: Settings) {
  interceptorActive = settings.active
  if (settings.active) useInterceptorStore.getState().applySettings(settings)
}

function intercept(e: Event) {
  if (interceptorActive === false) return
  e.preventDefault()
  e.stopImmediatePropagation()
  useInterceptorStore.getState().openIntercept(scrapeCheckout())
}

// Capture-phase delegation on window: runs before Amazon's own handlers and survives the
// button being re-rendered (address/payment changes swap out the checkout DOM).
function onClick(e: MouseEvent) {
  const target = e.target as Element | null
  if (target?.closest?.(CHECKOUT_SELECTORS)) intercept(e)
}

// Catches keyboard submission (Enter) of the order form, which never fires a click on the button.
function onSubmit(e: SubmitEvent) {
  if (e.submitter?.closest(CHECKOUT_SELECTORS)) intercept(e)
}

function init() {
  loadSettings().then(applySettings, () => {
    // Storage unreadable: keep intercepting with mock data rather than letting the order through.
    interceptorActive = true
  })
  onSettingsChanged(applySettings)
  mountOverlay()
  window.addEventListener('click', onClick, true)
  window.addEventListener('submit', onSubmit, true)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true })
} else {
  init()
}
