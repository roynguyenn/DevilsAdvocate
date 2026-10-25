import type { ServerRequest } from './api'

// All server calls go through here: content scripts on https://amazon.com can't reliably fetch http://localhost.
const SERVER = 'http://localhost:3001'

function toFetch(msg: ServerRequest): { path: string; body: unknown } {
  if (msg.type === 'evaluate') return { path: '/evaluate', body: msg.purchase }
  return { path: '/chat', body: { purchase: msg.purchase, history: msg.history } }
}

chrome.runtime.onMessage.addListener((msg: ServerRequest, _sender, sendResponse) => {
  if (msg.type !== 'evaluate' && msg.type !== 'chat') return false
  const { path, body } = toFetch(msg)
  fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: Error) => sendResponse({ ok: false, error: err.message }))
  return true // keep the channel open for the async sendResponse
})
