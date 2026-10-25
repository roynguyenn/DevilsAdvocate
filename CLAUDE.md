# CLAUDE.md - Project Context & Requirements
**Project Name:** Amazon Purchase Interceptor ("Devil's Advocate")
**Domain:** Fintech / Behavioral Economics / Browser Extension
**Goal:** Intercept Amazon purchases at checkout and show what the purchase does to the user's finances, using a deterministic financial score built from their (Capital One Nessie / seeded) account data. Claude explains the score in plain language and answers questions about it; it never decides.

## 1. Core Philosophy & Architecture
**Rule 1: Fast Path Interception.** The intercept is one `POST /evaluate` call: a pure-function score plus one short Claude call (~1 s). The overlay opens immediately with mock text and is replaced when the server answers.
**Rule 2: Secure by Design.** The extension contains NO API keys. All LLM calls and Nessie API keys live on the backend (`server/.env`). The extension talks to the server only through the background service worker.
**Rule 3: Checkout Only.** The intercept triggers ONLY on "Buy Now" and "Place your order" actions, NOT on "Add to Cart".
**Rule 4: The score decides, the LLM only words.** Verdicts (`inform` / `nudge` / `block`) come from `server/score.py`, which is deterministic and unit-tested. Claude receives the computed facts and writes text; it cannot change the score, the mode or the verdict, and every number in its output must appear in the facts (or the user's own messages) or the text is replaced with a template.

---

## 2. Tech Stack & Dependencies
*   **Extension:** Manifest V3, content scripts, background service worker. Built with `@crxjs/vite-plugin` (2.0.0-beta) on Vite 6.
*   **Frontend UI:** React 18, TypeScript (strict), Zustand (state management), Recharts 3 (data visualization), Framer Motion (animations), lucide-react (icons), Tailwind CSS **v3** (see Guardrails: v4 breaks inside Shadow DOM).
*   **Backend:** Python 3.10+, FastAPI + uvicorn on port 3001. State in JSON files (no database, no Redis). Dependencies in `server/requirements.txt`: fastapi, uvicorn[standard], httpx, python-dotenv, pydantic, anthropic, pytest. Responses are plain JSON (no SSE streaming yet).
*   **APIs:** Capital One Nessie API (mock banking), Anthropic Claude (wording and chat only). Model set by `ANTHROPIC_MODEL` in `server/.env`.

---

## 3. Component Specifications

### 3.1 Browser Extension (Manifest V3)
*   **Checkout URLs:** Amazon serves checkout at `https://www.amazon.com/checkout/*` (current "Chewbacca" pipeline, e.g. `/checkout/p/p-<id>/spc`) and the legacy `https://www.amazon.com/gp/buy/spc/handlers/display.html*`. `manifest.json` `host_permissions` and `content_scripts.matches` must list both and stay in sync. `host_permissions` also lists `http://localhost:3001/*` for the backend.
*   **DOM Interceptor:** Content script listens for clicks on checkout buttons (`#placeYourOrder1`, `#submitOrderButtonId`, `#bottomSubmitOrderButtonId`, or exact "Buy Now" selectors). Selectors live in one `CHECKOUT_SELECTORS` list in `src/content.tsx`. "Buy Now" is not yet implemented.
*   **Scraper:** On click, `preventDefault()` is called. Scrape the DOM for: `item_title`, `price`, `image_url` (thumbnail, `https://` only), and `category`. Every field falls back to mock values when a selector misses. `category` is not scraped yet, and the image selectors are unverified against the live Chewbacca checkout.
*   **Shadow DOM Root:** Mount the React application inside a Shadow DOM to completely isolate it from Amazon's global CSS.
*   **Service Worker (`src/background.ts`):** Proxies every backend call (content scripts on https pages can't reliably fetch `http://localhost`). Callers use `callServer()` from `src/api.ts`, which sends a typed `ServerRequest` message (`evaluate` or `chat`) and resolves with the server's JSON. No auth session yet.

### 3.2 Frontend (React UI)
*   **State:** Use a single `Zustand` store for charts, chat history, and verdict state. It holds a mock snapshot (`monthlyIncome`, `fixedBills`, `totalBudget` = discretionary budget, `spent`, `daysUntilPayday`, `ledger`); savings is derived (`selectSavings` = income − fixed bills − discretionary). The server's result lives in `evaluation` (set by `applyEvaluation`). **Known gap:** the charts and ledger still read the mock snapshot ($800 budget / $540 spent), while the score uses the server's data ($400 / $150), so they disagree until `/evaluate` returns the snapshot and the store uses it.
*   **Theme:** Dark overlay (see 7. Code Style → Styling for the exact palette).
*   **Animations:** Use `Framer Motion` for a smooth slide-in/fade-in of the overlay.
*   **Layout:** Two-panel split view sliding in from the right (stacks vertically below the `md` breakpoint).
    *   **Left Panel (Data/Vis), three cards top to bottom:**
        *   **Item + Income & Allocation card:** item thumbnail, title and price; below it monthly income and a horizontal stacked `div` bar splitting income into Fixed bills / Savings / Discretionary, with a labeled legend.
        *   **Monthly budget utilization card:** Recharts donut of the discretionary budget: Spent → *This purchase* (distinct, contrasting slice placed right after Spent) → Remaining, with a legend beside it. Hovering a slice or legend row expands that slice, dims the others, and shows a tooltip with name, amount and % of budget (e.g. "This purchase: $179.99 (22%)").
        *   **Recent Ledger (Transaction History) card:** scrollable list of recent Nessie purchases: category icon avatar, merchant + relative time, right-aligned negative amount. It fills the remaining panel height.
        *   *Not yet built:* Recharts bar chart of income vs. monthly spending pacing; a score gauge.
    *   **Right Panel (Agent/Chat):**
        *   Pinned verdict badge at the top: `[ Negotiating ]`, `[ Blocked ]`, or `[ Approved ]`. `Blocked` is set only when `/evaluate` returns `action: "block"`.
        *   Chat window. The first agent message is `Score <before> → <after>.` plus Claude's explanation. Replies arrive whole (not streamed). Agent bubbles are amber-tinted; user bubbles are zinc.
        *   User input: enabled once `evaluation` is set, disabled while the agent is replying, and capped at `MAX_USER_TURNS` = 3 replies (mirrors the server, which enforces it). Enter sends, Shift+Enter adds a newline. Sending goes through the store action `sendChat`.
        *   *Not yet built:* "Sleep on it 24h", "Make a commitment" and "Buy anyway" buttons; cooldown.

### 3.3 Backend (`server/`, FastAPI)
*   **Layout:** routes in `app.py` stay thin (load state → call pure functions → save state).
    *   `score.py`: pure functions only (no I/O, LLM or randomness). `compute_components`, `decide`, `evaluate` (returns the "facts" dict).
    *   `snapshot.py`: `get_financial_snapshot()` is the only way anything reads finances. Returns `{ balance, bills_14d, spent_this_month }`. `DATA_SOURCE=seed` (default) reads `data/seed_snapshot.json`; `DATA_SOURCE=nessie` reads the account in `data/nessie_ids.json` (balance from the account, bills = pending/recurring bills due in the next 14 days) while `spent_this_month` stays seeded.
    *   `nessie.py`: thin httpx client. Errors are re-raised as `NessieError` without the URL, because the URL carries the API key.
    *   `llm.py`: `explain(facts)` and `chat(facts, title, history)`, both through `_grounded_or`, which falls back to `template_message` when there's no key, the API errors, Claude refuses, or `numbers_are_grounded` fails.
    *   `store.py`: reads/writes `data/state.json` (settings, `regret_penalty`, `blocks_this_week`) and `data/commitments.json`, via temp file + rename. Both files are git-ignored and recreated from defaults.
*   **Endpoints:**
    *   `GET /health` → `{ ok: true }`.
    *   `POST /evaluate` `{ title, price, quantity?, category? }` → facts (`score_before`, `score_after`, `components_after`, `bills_14d`, `budget_left_after`, `mode`, `action`, `floor` in strict mode) + `message`.
    *   `POST /chat` `{ purchase, history: [{ role: user|assistant, content }] }` → `{ reply, done }`. History must end with a user turn; more than 3 user turns returns `done: true` without calling Claude. Facts are recomputed server-side, never taken from the client.
    *   `GET|PUT /settings` `{ budget, buffer_target, mode: aware|strict, floor }`.
    *   Stubs (TODO): `POST /commit`, `GET /followups`, `POST /outcome`, `POST /demo/skip-week`.
*   **Planned, not built:** a richer snapshot for the UI (`monthly_income`, `fixed_bills`, `days_until_payday`, `recent_transactions` for the Recent Ledger: latest ~10 Nessie `/purchases`, each `{ id, merchant, category, amount, timestamp }`, with `category` one of `shopping | transport | coffee | groceries | dining | subscriptions` to match `TransactionCategory` in `extension/src/store.ts`); signed unblock tokens; SSE streaming.

### 3.4 Capital One Nessie Integration
*   **Base URL:** `https://prod-api.nessieisreal.com` (set by `NESSIE_BASE`). Auth via `?key=` from `NESSIE_KEY` in `server/.env`. Everyone shares one sandbox, so use unique fake names and no real data.
*   **Verified behaviour:** creates return `{ code: 201, objectCreated: { _id, ... } }`; IDs are UUIDs (not 24-char ObjectIds); `GET /accounts/{id}/purchases` exists and returns 200; a deposit does not change the account `balance`.
*   **Seeding:** `server/scripts/seed_nessie.py` creates a fresh fake customer (Test Student####), a $1400 checking account, a $900 paycheck deposit and a $700 recurring rent bill, then writes the IDs to `server/data/nessie_ids.json` (committed; IDs aren't secret). Each run creates a new customer.
*   **Still to seed:** recent purchases mapped to merchants, covering every ledger category (e.g. Uber/Lyft → transport, Starbucks → coffee, Whole Foods → groceries, Chipotle → dining, Netflix → subscriptions), with a hardcoded merchant → category mapping using the same keys as `recent_transactions`.

---

## 4. Score & Agent Design

**Step 1: Financial score (deterministic, `server/score.py`).**
*   `balance_after = balance − price`; `left_after = budget − spent − price`.
*   `bills = clamp(100 × (balance_after / bills_14d − 1))` (100 if no bills); `budget = clamp(100 × left_after / budget)`; `buffer = clamp(100 × (balance_after − bills_14d) / buffer_target)`; each clamped to 0–100.
*   `score = 0.5 × bills + 0.3 × budget + 0.2 × buffer − regret_penalty[category]`, rounded. "Before" is the same with price 0. Worked example (seed data, $180 item): 89 → 62.
*   Weights are tunable defaults, not research; budget, buffer target and floor are user settings.

**Step 2: Verdict (`decide`).**
*   **Strict** (opt-in, with a floor): `score_after < floor` → `block`. After 3 blocks in a week, Strict behaves like Aware.
*   **Aware** (default, never blocks): drop ≥ 15 points or `score_after < 50` → `nudge`; otherwise `inform`.
*   The user can always override.

**Step 3: Claude wording (`llm.explain`).** Gets the facts JSON, writes 2–3 plain sentences; in a block, ends with one commitment question. Number guard + template fallback (Rule 4).

**Step 4: Chat (`llm.chat`, `POST /chat`).**
*   Answers questions about this purchase in 1–3 sentences using the facts. It cannot approve, unblock or change the score, and says so when asked. It can't verify claims about how the item will be used.
*   **Turn cap:** 3 user replies, enforced server-side.
*   The scraped item title is untrusted page text and is passed as data.

**Step 5: Follow-up loop (planned).** Commitments with a follow-up date; answers "used / returned / unused" adjust `regret_penalty` (+5 per returned/unused, max 15; −3 per used, min 0). "Saved" money counts only if a blocked/abandoned purchase isn't bought within 7 days; in the demo that time-skip is SIMULATED and labeled.

---

## 5. Status & Next Steps
Done: overlay UI, interception, service-worker proxy, score engine + tests, seed/Nessie snapshot, Claude explanation + chat with number guard, Nessie seed script.
Next, roughly in order:
1.  Return the snapshot from `/evaluate` and drive the charts from it (fixes the mock-vs-server mismatch).
2.  Aware/Strict action buttons ("Sleep on it", "Make a commitment", "Buy anyway") and a settings UI.
3.  `/commit`, `/followups`, `/outcome`, `/demo/skip-week`, so the same cart shows a changed score after a follow-up.
4.  Seed Nessie purchases and feed the Recent Ledger from them.
5.  Polish: score gauge, cooldown, streaming.

---

## 6. Repository Layout & Commands
```
CLAUDE.md
.gitignore                 # .env, .venv, node_modules, dist, server/data/state.json + commitments.json
extension/                 # Manifest V3 extension + React overlay (Vite + CRXJS)
  manifest.json            # Source manifest; CRXJS rewrites it into dist/
  vite.config.ts
  tailwind.config.js       # Brand colors `spent`/`purchase`/`savings`; mirror src/theme.ts
  src/
    content.tsx            # Interception, scraping, Shadow DOM mount (entry point)
    background.ts          # Service worker: the only code that calls the backend
    api.ts                 # callServer() + request/response types for the service worker
    App.tsx                # Overlay shell (dark theme), two-panel layout, slide-in animation
    store.ts               # The single Zustand store (mock snapshot, ledger, evaluation, chat, verdict)
    format.ts              # formatUsd / formatPercent / formatTimeAgo
    theme.ts               # CHART_COLORS: the only source of data-viz colors
    index.css              # Tailwind entry, injected into the shadow root via ?inline
    components/            # BudgetDonut, IncomeAllocation, RecentLedger, ChatPanel
server/                    # FastAPI backend (see 3.3)
  app.py score.py snapshot.py nessie.py llm.py store.py
  data/                    # seed_snapshot.json, nessie_ids.json (+ git-ignored state.json, commitments.json)
  scripts/                 # seed_nessie.py, reset_demo.py
  tests/                   # test_score.py, test_chat.py
  .env.example             # copy to server/.env (git-ignored)
```
Run from `extension/`:
*   `npm run dev`: dev build with HMR into `dist/`. The dev server **must keep running**; the dev `dist/` loads code from `localhost:5173`.
*   `npm run build`: typecheck (`tsc -b`) plus a standalone production build into `dist/`.
*   `npm run typecheck`: types only. Must pass before any change is considered done.
*   Load in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`. After a rebuild, click reload on the extension card and refresh the Amazon tab. After moving or renaming the project folder, remove the extension and load it again (Chrome tracks unpacked extensions by absolute path, and the extension ID changes).

Run from `server/` (one-time setup: `python -m venv .venv`, then `.venv/Scripts/python -m pip install -r requirements.txt`, then copy `.env.example` to `.env`):
*   `.venv/Scripts/python -m uvicorn app:app --port 3001 --reload`: start the backend.
*   `.venv/Scripts/python -m pytest`: run the tests. Must pass before any backend change is considered done.
*   `.venv/Scripts/python scripts/reset_demo.py`: restore default settings and clear commitments; run before every rehearsal.
*   `.venv/Scripts/python scripts/seed_nessie.py`: create a new fake Nessie customer and update `data/nessie_ids.json`.

---

## 7. Code Style

### General
*   TypeScript strict mode; no `any`, no `@ts-ignore`. `noUnusedLocals`/`noUnusedParameters` are on, so remove dead code instead of commenting it out.
*   Formatting: 2-space indent, single quotes, no semicolons, trailing commas in multiline literals, about 120 columns.
*   Python: standard 4-space style, type hints on public functions, short module docstrings explaining the module's role.
*   Comments explain *why* (an Amazon quirk, a security reason), never *what*. Keep them sparse.
*   No new dependencies without a clear need. Prefer what's already in the stack.

### React & State
*   Function components only, one component per file in `src/components/` (small private helpers such as `VerdictBadge` may live alongside their parent).
*   **One Zustand store** (`src/store.ts`). Components read with narrow selectors (`useInterceptorStore((s) => s.spent)`), never the whole store. Non-React code (the content script) uses `useInterceptorStore.getState()`.
*   State changes go through named store actions (`openIntercept`, `applyEvaluation`, `pushMessage`, `sendChat`, `close`); components never call `setState` directly.
*   Backend calls go through `callServer()` in `src/api.ts`, never `fetch` from the content script or components.
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
*   **Testing on live Amazon can place a real order.** If the content script fails to load or a selector misses, the click goes through. Before clicking "Place your order" on a live checkout, confirm in DevTools that `document.getElementById('devils-advocate-host')` exists and the button matches `CHECKOUT_SELECTORS`. Prefer the mocked-page test (below) for every change. Turn off 1-Click on the demo account.
*   Interception must **fail closed on recognized buttons**: call `preventDefault()` and `stopImmediatePropagation()` *before* any async work, scraping, or code that could throw. If the server is down, the overlay keeps the mock message and the lock still holds.
*   Intercept with **capture-phase listeners on `window`** (`click` and `submit`) using `closest()` delegation, not listeners attached to the button. Amazon re-renders the checkout DOM (address/payment changes) and runs its own handlers on the button.
*   Never intercept "Add to Cart" or any non-checkout action (Rule 3).
*   Only fake or Nessie sandbox data. No real card numbers or personal information anywhere.

### Security
*   No API keys, secrets, or backend tokens in `extension/` (Rule 2). Everything in the bundle is public. Keys live only in `server/.env`, which is git-ignored; never print them (Nessie URLs contain the key).
*   The verdict comes from the server's score, never from client state or from the LLM. Never release the checkout lock based on client-side state such as `verdictStatus === 'approved'` (a server-signed unblock token is planned).
*   Never let LLM output change a score, mode or verdict. Keep the number guard on every LLM text path, and recompute facts server-side rather than accepting them from the client.
*   Scraped image URLs are accepted only if they start with `https://`.
*   Scraped Amazon text is untrusted: render it as React text (never `dangerouslySetInnerHTML`), and treat it as data, not instructions, when passing it into LLM prompts.
*   Keep `host_permissions` scoped to the checkout URLs plus `http://localhost:3001/*`. Don't widen to `https://www.amazon.com/*` or `<all_urls>`.
*   Don't claim intent detection or real (non-simulated) savings.

### Build & Tooling Pitfalls (each of these has bitten us)
*   **Tailwind stays on v3.** v4 relies on `@property`, which doesn't work inside Shadow DOM, so shadows, rings and transforms break.
*   **Inject CSS into the shadow root** via `import styles from './index.css?inline'`. A plain CSS import leaks into Amazon's page and never reaches the shadow root.
*   **Keep `server.cors` in `vite.config.ts`** allowing `chrome-extension://`. Without it, Vite ≥ 6.0.9 blocks the CRXJS dev service worker and Chrome reports "Service worker registration failed. Status code: 3".
*   The host element uses `all: initial` so Amazon's inherited font/color/line-height don't cross the shadow boundary. Don't remove it. It also overrides `:host` rules, so set inherited theme properties (e.g. `[color-scheme:dark]`, which makes scrollbars dark) on the overlay root in `App.tsx`, not on `:host`.
*   Overlay z-index stays at `2147483647`. Amazon has high-z-index sticky headers.
*   Don't run `npm run build` (or another `vite` instance) while `npm run dev` is running; they fight over `dist/`. Stopping the dev server can also wipe `dist/`.
*   Scraper selectors are best-effort and Amazon changes markup often. Always keep a fallback, and verify selectors against a real checkout page before relying on them.
*   **Start uvicorn with `.venv/Scripts/python`, not a bare `python`.** A Python without the venv's packages (e.g. miniforge) crashes the `--reload` worker on `import anthropic` while the parent keeps port 3001, so requests hang and the overlay sits at "Waiting for the server…".
*   `server/.env` is read only at startup: restart uvicorn after editing it (`--reload` only watches code). `DATA_SOURCE=nessie` needs `data/nessie_ids.json`.
*   Git Bash treats `\` as an escape: use forward slashes in paths there (`.venv/Scripts/python`).

### Verification Before Calling Work Done
1.  `npm run typecheck` passes and `npm run build` succeeds; `.venv/Scripts/python -m pytest` passes in `server/`.
2.  Load the built extension in a browser and exercise the flow with the server running (`http://localhost:3001/health` returns `{"ok":true}`). A clean compile is **not** proof the extension works. Chrome/Chromium 137+ ignore `--load-extension`; for automated tests, launch Chromium with `--remote-debugging-port` and `--enable-unsafe-extension-debugging`, then call CDP `Extensions.loadUnpacked`. On macOS, copy `dist/` out of `~/Desktop` first, or Chromium can't read the path.
3.  Route the checkout URL to a mock page with the checkout button and assert: overlay mounts, Amazon's own click/submit handlers did **not** fire, the page did not navigate, the verdict badge shows, and the first message switches to the server's score.
4.  Screenshot the overlay at desktop (≈1400px) and narrow (≈700px) widths and actually look at them.
