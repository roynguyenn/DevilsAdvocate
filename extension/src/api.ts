export interface Purchase {
  title: string
  price: number
  category?: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export type ServerRequest =
  | { type: 'evaluate'; purchase: Purchase }
  | { type: 'chat'; purchase: Purchase; history: ChatTurn[] }
  | { type: 'purchase'; purchase: Purchase }

type ServerResponse<T> = { ok: true; data: T } | { ok: false; error: string }

// Round-trips through the service worker (background.ts), which owns every call to our server.
export function callServer<T>(msg: ServerRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res: ServerResponse<T> | undefined) => {
      if (res?.ok) resolve(res.data)
      else reject(new Error(res?.error ?? chrome.runtime.lastError?.message ?? 'no response'))
    })
  })
}
