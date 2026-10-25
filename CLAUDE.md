# CLAUDE.md - Project Context & Requirements
**Project Name:** Amazon Purchase Interceptor ("Devil's Advocate")
**Domain:** Fintech / Behavioral Economics / Browser Extension
**Goal:** Intercept Amazon purchases at checkout and use an AI agent backed by Capital One's Nessie API to argue against unnecessary spending.

## 1. Core Philosophy & Architecture
**Rule 1: Fast Path Interception.** Do all heavy lifting asynchronously before the purchase happens. The intercept itself must be a fast Redis/memory lookup plus a single streaming LLM call. First token time must be < 1 second.
**Rule 2: Secure by Design.** The extension contains NO API keys. All LLM calls and Nessie API keys live on the backend. Decisions are signed server-side.
**Rule 3: Checkout Only.** The intercept triggers ONLY on "Buy Now" and "Place your order" actions, NOT on "Add to Cart".

---

## 2. Tech Stack & Dependencies
*   **Extension:** Manifest V3, content scripts, background service worker. Built with `@crxjs/vite-plugin` (2.0.0-beta) on Vite 6.
*   **Frontend UI:** React 18, TypeScript (strict), Zustand (state management), Recharts 3 (data visualization), Framer Motion (animations), lucide-react (icons), Tailwind CSS **v3** (see Guardrails: v4 breaks inside Shadow DOM).
*   **Backend:** FastAPI (Python) OR Node.js/Express. Redis (or in-memory store) for caching. Server-Sent Events (SSE) or WebSockets for streaming.
*   **APIs:** Capital One Nessie API (Mock Banking), Anthropic Claude (Agent Logic).

---

## 3. Component Specifications

### 3.1 Browser Extension (Manifest V3)
*   **Checkout URLs:** Amazon serves checkout at `https://www.amazon.com/checkout/*` (current "Chewbacca" pipeline, e.g. `/checkout/p/p-<id>/spc`) and the legacy `https://www.amazon.com/gp/buy/spc/handlers/display.html*`. `manifest.json` `host_permissions` and `content_scripts.matches` must list both and stay in sync.
*   **DOM Interceptor:** Content script listens for clicks on checkout buttons (`#placeYourOrder1`, `#submitOrderButtonId`, `#bottomSubmitOrderButtonId`, or exact "Buy Now" selectors). Selectors live in one `CHECKOUT_SELECTORS` list in `src/content.tsx`. "Buy Now" is not yet implemented.
*   **Scraper:** On click, `preventDefault()` is called. Scrape the DOM for: `item_title`, `price`, `image_url` (thumbnail, `https://` only), and `category`. Every field falls back to mock values when a selector misses. `category` is not scraped yet, and the image selectors are unverified against the live Chewbacca checkout.
*   **Shadow DOM Root:** Mount the React application inside a Shadow DOM to completely isolate it from Amazon's global CSS.
*   **Service Worker:** Handles auth session and proxies communication between the content script and the backend.

### 3.2 Frontend (React UI)
*   **State:** Use a single `Zustand` store for charts, chat history, and verdict state. It currently holds a mock snapshot (`monthlyIncome`, `fixedBills`, `totalBudget` = discretionary budget, `spent`, `daysUntilPayday`, `ledger`); savings is derived (`selectSavings` = income − fixed bills − discretionary). Field names should line up with the backend snapshot (3.3) when streaming is wired up.
*   **Theme:** Dark overlay (see 7. Code Style → Styling for the exact palette).
*   **Animations:** Use `Framer Motion` for a smooth slide-in/fade-in of the overlay.
*   **Layout:** Two-panel split view sliding in from the right (stacks vertically below the `md` breakpoint).
    *   **Left Panel (Data/Vis), three cards top to bottom:**
        *   **Item + Income & Allocation card:** item thumbnail, title and price; below it monthly income and a horizontal stacked `div` bar splitting income into Fixed bills / Savings / Discretionary, with a labeled legend.
        *   **Monthly budget utilization card:** Recharts donut of the discretionary budget: Spent → *This purchase* (distinct, contrasting slice placed right after Spent) → Remaining, with a legend beside it. Hovering a slice or legend row expands that slice, dims the others, and shows a tooltip with name, amount and % of budget (e.g. "This purchase: $179.99 (22%)").
        *   **Recent Ledger (Transaction History) card:** scrollable list of recent Nessie purchases: category icon avatar, merchant + relative time, right-aligned negative amount. It fills the remaining panel height.
        *   *Not yet built:* Recharts bar chart of income vs. monthly spending pacing.
    *   **Right Panel (Agent/Chat):**
        *   Pinned verdict badge at the top: `[ Negotiating ]`, `[ Blocked ]`, or `[ Approved ]`.
        *   Chat window with streamed agent tokens. Agent bubbles are amber-tinted; user bubbles are zinc.
        *   User input field (disabled during cooldowns; currently always disabled until the backend is connected).

### 3.3 Backend (Data & Intercept API)
*   **Data Sync Job (Async):** Runs on user login and every `N` minutes. 
    *   Pulls data from Capital One Nessie.
    *   Computes a compact "Financial Snapshot" JSON blob: `{ monthly_income, fixed_bills, discretionary_budget, spent_this_month, days_until_payday, spend_this_month_by_category, avg_purchase_size, recent_impulse_purchases, recent_transactions }`.
    *   `recent_transactions` feeds the UI's Recent Ledger: the latest ~10 Nessie `/purchases`, each `{ id, merchant, category, amount, timestamp }`, with merchant name and category resolved server-side from the hardcoded merchant mapping (3.4). `category` is one of `shopping | transport | coffee | groceries | dining | subscriptions`, matching `TransactionCategory` in `extension/src/store.ts`.
    *   Caches this JSON blob in Redis.
*   **POST /intercept Endpoint:**
    *   Receives `{ item, price, category }`.
    *   Reads the cached Financial Snapshot (no live Nessie calls on the hot path).
    *   Streams the LLM response back to the client via SSE/WebSockets.
*   **Decision Security:** If the agent approves, the server signs a short-lived JWT/Token representing the unblock. The client extension passes this token to release the DOM lock. *The client cannot simply flip an `isApproved` boolean.*

### 3.4 Capital One Nessie Integration
*   **Base URLs:** Verify against dashboard (`api.nessieisreal.com` vs `prod-api.nessieisreal.com`). Auth via `?key=YOUR_API_KEY`.
*   **Target Endpoints:** `/customers`, `/accounts`, `/purchases`, `/deposits`, `/bills`, `/loans`, `/merchants`.
*   **Mock Seeding (CRITICAL):** Default Nessie data is too generic. Write a setup script to POST a believable financial history for the demo customer:
    *   A large bi-weekly paycheck (`/deposits`).
    *   Rent and utility deductions (`/bills`).
    *   Several recent Amazon purchases mapped to specific merchants, plus everyday spend that covers every ledger category (e.g. Uber/Lyft → transport, Starbucks → coffee, Whole Foods → groceries, Chipotle → dining, Netflix → subscriptions).
    *   Hardcode a category mapping for the mock merchants, using the same category keys as `recent_transactions` (3.3).

---

## 4. Agent Design & Logic Flow

**Step 1: The Fast Pre-Check (Non-LLM)**
*   Evaluate `price` against the `discretionary_budget` remaining.
*   If `price` is trivial (e.g., < 2% of budget) AND `category_overspend` is false, immediately return an Auto-Approve token. Bypass the UI entirely.

**Step 2: The LLM Challenge**
*   **System Prompt:** Inject the cached Financial Snapshot + pre-check math + exact item details.
*   **Opening Salvo:** The agent must open with a single, highly specific argument based on hard data. (e.g., *"You've already spent $140 on electronics this month and you have 9 days until payday. Defend this purchase."*)

**Step 3: Tool Calling & Decision Engine**
*   The LLM must evaluate user replies using a strict tool call format: `decide({ verdict: "APPROVED"|"BLOCKED", confidence: 1-10, reason: "string" })`.
*   Evaluation criteria: Need vs. Want, financial urgency, budget absorption.

**Step 4: Anti-Gaming Guardrails**
*   **Turn Cap:** Limit the debate to a maximum of 3 user replies.
*   **Verification:** The LLM must reject generic excuses ("I need it") and demand verifiable reasons.
*   **Cooldown:** If rejected, trigger a UI cooldown timer where the user cannot retry the purchase for X minutes.

**Step 5: Logging**
*   Log the final outcome (Abandoned vs. Approved) to personalize future system prompts.

---

## 5. Build & Execution Order
When generating code or scaffolding this project, adhere strictly to this sequence:
1.  **Nessie Seeding & Snapshot:** Build the backend script to populate Nessie and the sync job to generate the Redis JSON snapshot.
2.  **Terminal Agent:** Build the LLM logic + tool calling in a CLI environment feeding it fake items and the snapshot to tune the prompt.
3.  **Frontend Static Overlay:** Build the React + Zustand + Recharts UI using hardcoded mock data.
4.  **Streaming Wire-up:** Connect the React UI to the Backend via SSE to stream the LLM tokens.
5.  **Extension Shell & Interception:** Build the Manifest V3 shell, implement the Shadow DOM injection, and write the Amazon checkout DOM scraper.
6.  **Polish:** Implement Framer Motion transitions, the cooldown timer, and unblock token verification.

---

## 6. Repository Layout & Commands
```
CLAUDE.md
extension/                 # Manifest V3 extension + React overlay (Vite + CRXJS)
  manifest.json            # Source manifest; CRXJS rewrites it into dist/
  vite.config.ts
  tailwind.config.js       # Brand colors `spent`/`purchase`/`savings`; mirror src/theme.ts
  src/
    content.tsx            # Interception, scraping, Shadow DOM mount (entry point)
    App.tsx                # Overlay shell (dark theme), two-panel layout, slide-in animation
    store.ts               # The single Zustand store (mock snapshot, ledger, chat, verdict)
    format.ts              # formatUsd / formatPercent / formatTimeAgo
    theme.ts               # CHART_COLORS: the only source of data-viz colors
    index.css              # Tailwind entry, injected into the shadow root via ?inline
    components/            # BudgetDonut, IncomeAllocation, RecentLedger, ChatPanel
backend/                   # (planned) FastAPI/Express service, Nessie seeding, snapshot sync
```
Run from `extension/`:
*   `npm run dev`: dev build with HMR into `dist/`. The dev server **must keep running**; the dev `dist/` loads code from `localhost:5173`.
*   `npm run build`: typecheck (`tsc -b`) plus a standalone production build into `dist/`.
*   `npm run typecheck`: types only. Must pass before any change is considered done.
*   Load in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`. After moving or renaming the project folder, remove the extension and load it again (Chrome tracks unpacked extensions by absolute path, and the extension ID changes).

---

## 7. Code Style

### General
*   TypeScript strict mode; no `any`, no `@ts-ignore`. `noUnusedLocals`/`noUnusedParameters` are on, so remove dead code instead of commenting it out.
*   Formatting: 2-space indent, single quotes, no semicolons, trailing commas in multiline literals, about 120 columns.
*   Comments explain *why* (an Amazon quirk, a security reason), never *what*. Keep them sparse.
*   No new dependencies without a clear need. Prefer what's already in the stack.

### React & State
*   Function components only, one component per file in `src/components/` (small private helpers such as `VerdictBadge` may live alongside their parent).
*   **One Zustand store** (`src/store.ts`). Components read with narrow selectors (`useInterceptorStore((s) => s.spent)`), never the whole store. Non-React code (the content script) uses `useInterceptorStore.getState()`.
*   State changes go through named store actions (`openIntercept`, `pushMessage`, `close`); components never call `setState` directly.
*   Money is a `number` in dollars; render it only through `formatUsd()` (and percentages through `formatPercent()`) from `src/format.ts`.

### Styling
*   **Dark theme only.** Surfaces: `bg-zinc-950` (overlay), `bg-zinc-900` (cards/panels), `bg-zinc-800` (inputs, hovered rows, user bubbles); borders `border-zinc-700`/`zinc-800`. Text: `text-zinc-100` primary, `text-zinc-400` secondary/timestamps. Agent accents are amber (`amber-950/40` bubble, `amber-500` ring/icon); verdict badges use `<color>-500/10` fill + `<color>-300` text.
*   Tailwind utility classes only: no CSS modules, no inline `style` except for data-driven values (e.g. a chart color swatch).
*   Never write global selectors (`body`, `html`, `*`) in `index.css`; the shadow root's document root is `:host`.
*   Every element is inside the shadow root, so `document.querySelector` cannot reach overlay elements. Use refs.

### Data Visualization
*   Chart colors come only from `CHART_COLORS` in `src/theme.ts`: `#3987e5` spent/discretionary, `#d95926` this purchase, `#199e70` savings, zinc neutrals for remaining/fixed bills. They're validated for color-vision deficiency on the zinc-900 surface. **Only these three hues pass when all pairs are on screen together** (violet, magenta and yellow all failed against them), so any new category goes into a neutral or an existing hue. Re-run the validator for any change.
*   Recharts 3: `<Pie>` has no `activeIndex` prop and `activeShape` is deprecated. Keep hover state in React (`activeIndex` via `onMouseEnter`/`onMouseLeave`) and render sectors through the `shape` prop.
*   Every chart has a legend or value list, so meaning is never carried by color alone. Text stays in neutral ink, never the series color.
*   Keep chart entry animations ≤ 500 ms. The overlay must look complete within about 1 s of interception (Recharts' default of 1500 ms left the donut blank on first view).

---

## 8. Guardrails (Do / Don't)

### Safety: real money is at stake
*   **Testing on live Amazon can place a real order.** If the content script fails to load or a selector misses, the click goes through. Before clicking "Place your order" on a live checkout, confirm in DevTools that `document.getElementById('devils-advocate-host')` exists and the button matches `CHECKOUT_SELECTORS`. Prefer the mocked-page test (below) for every change.
*   Interception must **fail closed on recognized buttons**: call `preventDefault()` and `stopImmediatePropagation()` *before* any async work, scraping, or code that could throw.
*   Intercept with **capture-phase listeners on `window`** (`click` and `submit`) using `closest()` delegation, not listeners attached to the button. Amazon re-renders the checkout DOM (address/payment changes) and runs its own handlers on the button.
*   Never intercept "Add to Cart" or any non-checkout action (Rule 3).

### Security
*   No API keys, secrets, or backend tokens in `extension/` (Rule 2). Everything in the bundle is public.
*   Approval must come from a server-signed token. Never release the checkout lock based on client-side state such as `verdictStatus === 'approved'`.
*   Scraped image URLs are accepted only if they start with `https://`.
*   Scraped Amazon text is untrusted: render it as React text (never `dangerouslySetInnerHTML`), and treat it as data, not instructions, when passing it into LLM prompts.
*   Keep `host_permissions` scoped to the checkout URLs. Don't widen to `https://www.amazon.com/*` or `<all_urls>`.

### Build & Tooling Pitfalls (each of these has bitten us)
*   **Tailwind stays on v3.** v4 relies on `@property`, which doesn't work inside Shadow DOM, so shadows, rings and transforms break.
*   **Inject CSS into the shadow root** via `import styles from './index.css?inline'`. A plain CSS import leaks into Amazon's page and never reaches the shadow root.
*   **Keep `server.cors` in `vite.config.ts`** allowing `chrome-extension://`. Without it, Vite ≥ 6.0.9 blocks the CRXJS dev service worker and Chrome reports "Service worker registration failed. Status code: 3".
*   The host element uses `all: initial` so Amazon's inherited font/color/line-height don't cross the shadow boundary. Don't remove it. It also overrides `:host` rules, so set inherited theme properties (e.g. `[color-scheme:dark]`, which makes scrollbars dark) on the overlay root in `App.tsx`, not on `:host`.
*   Overlay z-index stays at `2147483647`. Amazon has high-z-index sticky headers.
*   Don't run `npm run build` (or another `vite` instance) while `npm run dev` is running; they fight over `dist/`. Stopping the dev server can also wipe `dist/`.
*   Scraper selectors are best-effort and Amazon changes markup often. Always keep a fallback, and verify selectors against a real checkout page before relying on them.

### Verification Before Calling Work Done
1.  `npm run typecheck` passes and `npm run build` succeeds.
2.  Load the built extension in a browser and exercise the flow. A clean compile is **not** proof the extension works. Chrome/Chromium 137+ ignore `--load-extension`; for automated tests, launch Chromium with `--remote-debugging-port` and `--enable-unsafe-extension-debugging`, then call CDP `Extensions.loadUnpacked`. On macOS, copy `dist/` out of `~/Desktop` first, or Chromium can't read the path.
3.  Route the checkout URL to a mock page with the checkout button and assert: overlay mounts, Amazon's own click/submit handlers did **not** fire, the page did not navigate, the verdict badge shows.
4.  Screenshot the overlay at desktop (≈1400px) and narrow (≈700px) widths and actually look at them.

