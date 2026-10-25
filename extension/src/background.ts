import type { ServerRequest } from './api'

// All server calls go through here: content scripts on https://amazon.com can't reliably fetch http://localhost.
const SERVER = 'http://localhost:3001'

interface Route {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  body?: unknown
}

function toRoute(msg: ServerRequest): Route {
  switch (msg.type) {
    case 'evaluate':
      return { method: 'POST', path: '/evaluate', body: msg.purchase }
    case 'purchase':
      return { method: 'POST', path: '/purchase', body: msg.purchase }
    case 'chat':
      return { method: 'POST', path: '/chat', body: { purchase: msg.purchase, history: msg.history } }
    case 'accounts':
      return { method: 'GET', path: '/accounts' }
    case 'getProfile':
      return { method: 'GET', path: msg.accountId ? `/profile?account_id=${encodeURIComponent(msg.accountId)}` : '/profile' }
    case 'saveProfile':
      return { method: 'PUT', path: '/profile', body: msg.profile }
    case 'customers':
      return { method: 'GET', path: '/customers' }
    case 'selectCustomer':
      return { method: 'PUT', path: '/customer', body: { customer_id: msg.customerId } }
    case 'decision':
      return { method: 'POST', path: '/decision', body: { purchase: msg.purchase, history: msg.history, outcome: msg.outcome } }
  }
}

const KNOWN_TYPES = new Set<ServerRequest['type']>([
  'evaluate', 'chat', 'purchase', 'accounts', 'getProfile', 'saveProfile', 'customers', 'selectCustomer', 'decision',
])

// FastAPI puts a human-readable reason in `detail` (a string for our own errors, a list for validation errors).
async function errorMessage(r: Response): Promise<string> {
  const body = (await r.json().catch(() => null)) as { detail?: unknown } | null
  return typeof body?.detail === 'string' ? body.detail : `HTTP ${r.status}`
}

chrome.runtime.onMessage.addListener((msg: ServerRequest, _sender, sendResponse) => {
  if (!KNOWN_TYPES.has(msg.type)) return false
  const { method, path, body } = toRoute(msg)
  fetch(`${SERVER}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await errorMessage(r)))))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: Error) => sendResponse({ ok: false, error: err.message }))
  return true // keep the channel open for the async sendResponse
})
