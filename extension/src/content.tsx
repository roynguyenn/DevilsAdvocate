import { createRoot } from 'react-dom/client'
import App from './App'
import { callServer } from './api'
import styles from './index.css?inline'
import { loadSettings, onSettingsChanged, type Settings } from './settings'
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

const MONEY = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/

// First dollar amount in the text. Stripping every non-digit instead would glue "$179.99 $14.40" into 179.9914.
const parsePrice = (text: string | null | undefined) => {
  const m = (text ?? '').match(MONEY)
  const n = m ? parseFloat(m[1].replace(/,/g, '')) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

// Amount on the order-summary row whose label matches, whatever classes Amazon currently uses: find the label's
// text node, then climb to the nearest ancestor (the row) that also contains a dollar amount.
function priceByLabel(label: RegExp) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!label.test(node.textContent?.trim() ?? '')) continue
    let el = node.parentElement
    for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
      const price = parsePrice(el.textContent)
      if (price !== null) return price
    }
  }
  return null
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

// The goods being bought: the order summary's item subtotal ("Items (2):") before shipping and tax, then
// the line-item price, and only then the grand total.
function scrapePrice() {
  return (
    priceByLabel(/^Items(\s*\(\d+\))?\s*:?$/i) ??
    parsePrice(firstText(['.lineitem-price-text', '[data-csa-c-content-id*="item-price"]', '.item-price'])) ??
    parsePrice(
      firstText(['.grand-total-price', '#subtotals-marketplace-table .a-color-price', '.order-summary-grand-total .a-text-right']),
    ) ??
    priceByLabel(/^Order total\s*:?$/i)
  )
}

// Best-effort scrape of the checkout page. A missing price stays null (the overlay says so); a missing title gets
// a neutral label.
function scrapeCheckout(): InterceptedItem {
  const name = firstText([
    '.lineitem-title-text',
    '[data-csa-c-content-id*="item-title"]',
    '.item-title',
    '.a-row.breakword .a-text-bold',
  ])
  const price = scrapePrice()
  if (price === null) console.warn('[devils-advocate] no price found on the checkout page')
  return {
    name: name ?? 'Your Amazon order',
    price,
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
  const item = scrapeCheckout()
  useInterceptorStore.getState().openIntercept(item)
  requestEvaluation(item)
}

// If the server or the bank is down the overlay says so and the lock still holds.
function requestEvaluation(item: InterceptedItem) {
  // No price, nothing to score: the overlay already says so and the lock holds.
  if (item.price === null) return
  callServer<Evaluation>({ type: 'evaluate', purchase: { title: item.name, price: item.price } })
    .then((e) => useInterceptorStore.getState().applyEvaluation(e))
    .catch((err: Error) => {
      console.warn('[devils-advocate] evaluate failed:', err.message)
      useInterceptorStore.getState().failEvaluation()
    })
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
    // Storage unreadable: keep intercepting rather than letting the order through.
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
