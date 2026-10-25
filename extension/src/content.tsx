import { createRoot } from 'react-dom/client'
import App from './App'
import { callServer } from './api'
import styles from './index.css?inline'
import { loadSettings, loadTestMode, onSettingsChanged, onTestModeChanged, type Settings } from './settings'
import { cartTitle, useInterceptorStore, type CartItem, type Evaluation, type InterceptedCart } from './store'

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

const firstText = (selectors: string[], root: ParentNode = document) => {
  for (const sel of selectors) {
    const text = root.querySelector(sel)?.textContent?.trim()
    if (text) return text
  }
  return null
}

// Only https URLs: the src is page-controlled and gets rendered inside our overlay.
const firstImage = (selectors: string[], root: ParentNode = document) => {
  for (const sel of selectors) {
    const src = root.querySelector<HTMLImageElement>(sel)?.src
    if (src?.startsWith('https://')) return src
  }
  return null
}

// Most specific first; the last one is broad, so it's only used when nothing better matches.
const TITLE_SELECTORS = [
  '.lineitem-title-text',
  '[data-csa-c-content-id*="item-title"]',
  '.item-title',
  '.a-row.breakword .a-text-bold',
]
// Amazon's price component keeps the clean amount in .a-offscreen; its visible text is split into pieces
// ("$" "28" "." "99"). Only the "price to pay" one: a row can also hold unrelated a-prices (the Prime upsell's $14.99).
const ITEM_PRICE_SELECTORS = [
  '.apex-price-to-pay-value .a-offscreen',
  '.lineitem-price-text',
  '[data-csa-c-content-id*="item-price"]',
  '.item-price',
]
const ITEM_IMAGE_SELECTORS = ['.lineitem-image img', '[data-csa-c-content-id*="item-image"] img', '.item-image img']
const QUANTITY = /(?<![a-z])Q(?:ty|uantity)\s*:?\s*(\d+)/i
const ITEMS_LABEL = /^Items\s*(?:\((\d+)\))?\s*:?$/i
const MAX_ROW_DEPTH = 8

// A line item's row: climb from its title while the ancestor holds no other item's title. With one item there
// is no neighbour to stop at, so the climb is capped to keep the order summary's prices out of the row.
function lineItemRow(title: Element, titles: Element[]) {
  let row = title
  let el = title.parentElement
  for (let depth = 0; el && el !== document.body; depth++, el = el.parentElement) {
    const parent = el
    if (titles.length === 1 ? depth >= MAX_ROW_DEPTH : titles.some((t) => t !== title && parent.contains(t))) break
    row = parent
  }
  return row
}

// Text as a reader sees it. textContent would include the hidden <option>s of Amazon's quantity dropdown
// ("Qty:12345678910" + "2" reads as 123456789102) and glue neighbouring nodes ("$8.25Qty: 3").
function visibleText(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('select, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const parts: string[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? '')
  return parts.join(' ')
}

const positiveInt = (value: string | null | undefined) => {
  const n = Number(value?.trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

// Quantity of the line item(s) in `root`, from the most reliable signal Amazon renders.
function quantityIn(root: Element) {
  // The checkout's +/- stepper: <span data-a-selector="inner-value">4</span>.
  const stepper = root.querySelector('[data-a-selector="inner-value"], [data-a-selector="value"]')
  if (positiveInt(stepper?.textContent)) return positiveInt(stepper?.textContent)
  // A dropdown whose options are all whole numbers is a quantity picker, whatever it's named.
  for (const select of root.querySelectorAll('select')) {
    const options = [...select.options]
    if (options.length && options.every((o) => positiveInt(o.value) !== null)) return positiveInt(select.value)
  }
  const input = root.querySelector<HTMLInputElement>('input[name*="quantity" i], input[id*="quantity" i], input[name="qty" i]')
  if (positiveInt(input?.value)) return positiveInt(input?.value)
  for (const el of root.querySelectorAll('[aria-label]')) {
    const m = el.getAttribute('aria-label')?.match(QUANTITY)
    if (m) return positiveInt(el.getAttribute('aria-valuenow')) ?? positiveInt(m[1])
  }
  return positiveInt(visibleText(root).match(QUANTITY)?.[1])
}

// The order summary's unit count: "Items (3):" -> 3.
function summaryItemCount() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const count = positiveInt(n.textContent?.trim().match(ITEMS_LABEL)?.[1])
    if (count) return count
  }
  return null
}

interface ScrapedItem extends Omit<CartItem, 'quantity'> {
  quantity: number | null
}

function scrapeItem(title: Element, titles: Element[]): ScrapedItem {
  const row = lineItemRow(title, titles)
  return {
    name: title.textContent?.trim() || 'Amazon item',
    // Known price elements only: guessing from the row's text picked up unrelated prices such as Prime's.
    price: parsePrice(firstText(ITEM_PRICE_SELECTORS, row)),
    // A lone line item owns every quantity control on the page, even one nested deeper than its row.
    quantity: quantityIn(row) ?? (titles.length === 1 ? quantityIn(document.body) : null),
    imageUrl: firstImage(ITEM_IMAGE_SELECTORS, row),
  }
}

const cents = (n: number) => Math.round(n * 100) / 100
const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005

// Checks the line items against the order summary. Fills a quantity the line items didn't show from the
// "Items (N):" unit count (or, for a lone item, subtotal / unit price), and spots line prices that are already
// price x quantity, so they aren't multiplied twice.
function reconcile(items: ScrapedItem[]): CartItem[] {
  const subtotal = priceByLabel(ITEMS_LABEL)
  const unknown = items.filter((i) => i.quantity === null)
  if (unknown.length === 1) {
    const known = items.reduce((sum, i) => sum + (i.quantity ?? 0), 0)
    const count = summaryItemCount()
    const ratio = items.length === 1 && subtotal && items[0].price ? subtotal / items[0].price : null
    unknown[0].quantity =
      (count && count > known ? count - known : null) ??
      (ratio && Math.abs(ratio - Math.round(ratio)) < 0.01 ? positiveInt(String(Math.round(ratio))) : null)
  }
  const resolved = items.map((i) => ({ ...i, quantity: i.quantity ?? 1 }))

  const priced = resolved.every((i) => i.price !== null)
  const sum = (perUnit: boolean) => resolved.reduce((t, i) => t + (i.price ?? 0) * (perUnit ? i.quantity : 1), 0)
  const lineTotals = subtotal !== null && priced && !sameMoney(sum(true), subtotal) && sameMoney(sum(false), subtotal)
  return lineTotals ? resolved.map((i) => ({ ...i, price: cents((i.price ?? 0) / i.quantity) })) : resolved
}

function scrapeItems(): CartItem[] {
  for (const sel of TITLE_SELECTORS) {
    const titles = [...document.querySelectorAll(sel)].filter((t) => t.textContent?.trim())
    if (titles.length) return reconcile(titles.map((t) => scrapeItem(t, titles)))
  }
  return []
}

// The goods being bought: the order summary's item subtotal ("Items (2):") before shipping and tax, then the
// sum of the line items (if every one has a price), and only then the grand total.
function scrapeTotal(items: CartItem[]) {
  const lineSum =
    items.length > 0 && items.every((i) => i.price !== null)
      ? cents(items.reduce((sum, i) => sum + (i.price ?? 0) * i.quantity, 0))
      : null
  return (
    priceByLabel(ITEMS_LABEL) ??
    lineSum ??
    parsePrice(
      firstText(['.grand-total-price', '#subtotals-marketplace-table .a-color-price', '.order-summary-grand-total .a-text-right']),
    ) ??
    priceByLabel(/^Order total\s*:?$/i)
  )
}

// Best-effort scrape of every item on the checkout page. A missing total stays null (the overlay says so).
function scrapeCheckout(): InterceptedCart {
  const scraped = scrapeItems()
  const total = scrapeTotal(scraped)
  if (total === null) console.warn('[devils-advocate] no price found on the checkout page')
  // Lets a tester compare what was read against the page when Amazon's markup changes.
  console.info('[devils-advocate] scraped cart', scraped, 'total', total)
  const items = scraped.length
    ? scraped
    : [{ name: 'Your Amazon order', price: total, quantity: 1, imageUrl: firstImage(ITEM_IMAGE_SELECTORS) }]
  return { items, total }
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
  const cart = scrapeCheckout()
  useInterceptorStore.getState().openIntercept(cart)
  requestEvaluation(cart)
}

// If the server or the bank is down the overlay says so and the lock still holds.
function requestEvaluation(cart: InterceptedCart) {
  // No price, nothing to score: the overlay already says so and the lock holds.
  if (cart.total === null) return
  callServer<Evaluation>({ type: 'evaluate', purchase: { title: cartTitle(cart.items), price: cart.total } })
    .then((e) => useInterceptorStore.getState().applyEvaluation(e))
    .catch((err: Error) => {
      console.warn('[devils-advocate] evaluate failed:', err.message)
      useInterceptorStore.getState().failEvaluation()
    })
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
    // Storage unreadable: keep intercepting rather than letting the order through.
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
