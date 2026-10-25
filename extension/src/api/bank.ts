import { callServer } from '../api'
import type { LinkedAccount } from '../settings'

// Capital One (Nessie) account linking. The backend holds the Nessie key and returns only display metadata
// ({ id, nickname, last4 }) for the demo customer's checking accounts; the extension never sees credentials.

export const fetchAuthorizableAccounts = () => callServer<LinkedAccount[]>({ type: 'accounts' })

// The sign-in step is simulated: Nessie has no OAuth, so authorizing just confirms the choice after a beat.
export const authorizeAccount = (account: LinkedAccount) =>
  new Promise<LinkedAccount>((resolve) => setTimeout(() => resolve(account), 700))
