# CLAUDE.md - Project Context & Requirements
**Project Name:** Amazon Purchase Interceptor ("Devil's Advocate")
**Domain:** Fintech / Behavioral Economics / Browser Extension
**Goal:** Intercept Amazon purchases at checkout and show what the purchase does to the user's finances, using a deterministic financial score built from their (Capital One Nessie / seeded) account data. Claude explains the score in plain language and answers questions about it; it never decides.

## 1. Core Philosophy & Architecture
**Rule 1: Fast Path Interception.** The intercept is one `POST /evaluate` call: a pure-function score plus one short Claude call (~1 s). The overlay opens immediately with mock text and is replaced when the server answers.
**Rule 2: Secure by Design.** The extension contains NO API keys. All LLM calls and Nessie API keys live on the backend (`server/.env`). The extension talks to the server only through the background service worker.
**Rule 3: Checkout Only.** The intercept triggers ONLY on "Buy Now" and "Place your order" actions, NOT on "Add to Cart".
**Rule 4: The score decides, the LLM only words.** Verdicts (`inform` / `nudge` / `block`) come from `server/score.py`, which is deterministic and unit-tested. Claude receives money facts and the verdict and writes text; it cannot change the verdict, and every number in its output must appear in the facts (or the user's own messages) or the text is replaced with a template.
**Rule 5: The score is a hidden threshold.** The score, its components, the floor and the mode never reach the user: not in the UI, not in `/evaluate`'s response (except `?debug=true`), and not in Claude's input (`llm.public_facts`). Claude's replies are rejected if they mention a score, rating, threshold, floor or algorithm (`llm.mentions_internals`). The user only ever hears about bills, budget and balance.

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
*   **Activation gate:** The content script only intercepts while `settings.active` is true: it's set by **Save & Activate** in the popup and cleared by the popup's Disable switch. Until `chrome.storage` answers, it intercepts anyway (fail closed). If storage can't be read, it keeps intercepting with mock data.
*   **Shadow DOM Root:** Mount the React application inside a Shadow DOM to completely isolate it from Amazon's global CSS.
*   **Toolbar Popup (Configuration):** `action.default_popup` → `src/popup/index.html`, shown when the user clicks the extension icon. See 3.2.1.
*   **Service Worker (`src/background.ts`):** Proxies every backend call (content scripts on https pages can't reliably fetch `http://localhost`). Callers use `callServer()` from `src/api.ts`, which sends a typed `ServerRequest` message (`evaluate`, `chat` or `purchase`) and resolves with the server's JSON. No auth session yet.

### 3.2 Frontend (React UI)
*   **State:** Use a single `Zustand` store for charts, chat history, and verdict state. It holds a mock snapshot (`monthlyIncome`, `fixedBills`, `totalBudget` = discretionary budget, `spent`, `daysUntilPayday`, `ledger`); savings is derived (`selectSavings` = income − fixed bills − discretionary). The server's result lives in `evaluation` (set by `applyEvaluation`), which also replaces `totalBudget`, `spent` and `ledger` with the server's snapshot so the donut and Recent Ledger match the score. The mock values only show until the server answers. `monthlyIncome`, `fixedBills`, `savings` and `intensity` come from the popup's saved settings (`applySettings`). **Known gap:** the popup's Discretionary amount and the server's `settings.budget` are two separate budgets. The popup fills `totalBudget` first, then `applyEvaluation` overwrites it with the server's budget, so the score ignores what the user typed. Fix: have the popup `PUT /settings` on save (discretionary → `budget`).
*   **Theme:** Dark overlay (see 7. Code Style → Styling for the exact palette).
*   **Animations:** Use `Framer Motion` for a smooth slide-in/fade-in of the overlay.
*   **Layout:** Two-panel split view sliding in from the right (stacks vertically below the `md` breakpoint).
    *   **Left Panel (Data/Vis), three cards top to bottom:**
        *   **Item + Income & Allocation card:** item thumbnail, title and price; below it monthly income and a horizontal stacked `div` bar splitting income into Fixed bills / Savings / Discretionary, with a labeled legend.
        *   **Monthly budget utilization card:** Recharts donut of the discretionary budget: Spent → *This purchase* (distinct, contrasting slice placed right after Spent) → Remaining, with a legend beside it. Hovering a slice or legend row expands that slice, dims the others, and shows a tooltip with name, amount and % of budget (e.g. "This purchase: $179.99 (22%)").
        *   **Recent Ledger (Transaction History) card:** scrollable list of recent Nessie purchases: category icon avatar, merchant + relative time, right-aligned negative amount. It fills the remaining panel height.
        *   *Not yet built:* Recharts bar chart of income vs. monthly spending pacing; a score gauge.
    *   **Right Panel (Agent/Chat):**
        *   Pinned verdict badge at the top, mapped from `/evaluate`'s action: `inform` → `[ Approved ]` (under the threshold: the overlay still opens, but says they're fine to buy it), `nudge` → `[ Negotiating ]`, `block` → `[ Blocked ]`.
        *   Testing-mode banner under the header (`TestModeBanner`) while testing mode is on.
        *   Chat window. The first agent message is Claude's explanation (money only, no score; Rule 5). Replies arrive whole (not streamed). Agent bubbles are amber-tinted; user bubbles are zinc.
        *   User input: enabled once `evaluation` is set, disabled while the agent is replying, and closed (`chatClosed`, placeholder "Time to decide.") when `/chat` returns `done: true`. **The reply cap is hidden:** the extension doesn't know or show it, so there's no countdown to bargain against. Enter sends, Shift+Enter adds a newline. Sending goes through the store action `sendChat`.
        *   **"Buy anyway (simulated)"** (`SimulatedBuyButton`, store action `simulatePurchase`): logs the item as a fake purchase via `POST /purchase`, then updates the ledger and spent from the returned snapshot. The checkout click stays blocked, so no Amazon order is placed. One click per intercept.
        *   *Not yet built:* "Sleep on it 24h" and "Make a commitment" buttons; cooldown.

### 3.2.1 Configuration Popup (`src/popup/`)
*   Fixed 440×600 page (Chrome's popup maximum height is 600px), same dark tokens as the overlay. The header has an **Enabled/Disabled switch** (see below). Below it, a tab bar (**1 Account · 2 Finances · 3 Agent**) shows **one section at a time**, each tab with a completion check (green) or a needs-attention dot (amber). Tabs follow the WAI-ARIA pattern (`role="tab"`, arrow-key navigation). The save bar stays pinned to the bottom.
*   **No scrolling:** each section must fit the panel area (≈384px between the tabs and the save bar). Check `main.scrollHeight <= clientHeight` when changing a section's content.
*   **Navigation:** the popup opens on the first incomplete section. Linking a bank during first-time setup moves on to Finances. When saving is blocked by a field on another tab, the hint under the save button links to that tab.
*   **Account Connection:** an amber "Connect Bank Account" button opens a simulated Capital One / Nessie OAuth modal (`src/api/bank.ts`, mock accounts). Once linked, it shows a green "Linked: <nickname> ending in ****1234" with a Disconnect link. **Never** add a credential or API-key field: the real flow goes through the backend, and the extension stores only `{ id, nickname, last4 }`.
*   **Financial Baseline & Allocation (Finances tab):** a large monthly net income input, a live `AllocationBar` preview, and a currency input plus slider for Fixed Bills (gray), Savings (green) and Discretionary (blue).
    *   **Rebalancing:** editing income, fixed bills or savings auto-fills discretionary with the remainder. A manual discretionary override rebalances **savings only**; fixed bills are real obligations and never move automatically.
    *   **Validation:** math is done in whole cents. Over-allocation shows a hatched red tail on the bar and blocks saving.
*   **Agent Intervention:** a three-card radiogroup: Light / The Gentle Nudge (yellow caution icon), Medium / The Negotiator (amber scales, default), Harsh / The Interrogator (red flame). Harsh's cooling-off rule comes from `HARSH_COOLDOWN` in `src/settings.ts` (5 minutes, over 10% of the budget). The intensity currently only changes the mock opening line; the real prompt and cooldown behavior arrive with the backend.
*   **Save bar:** "Save & Activate Interceptor" stays disabled, with the reason shown underneath, until a bank is linked and the split equals 100% of a positive income. After activation the button reads "Save Changes" and is only enabled when something has changed.
*   **Testing / Live switch** (`TestModeSwitch`, under the Enabled switch): stored as its own `testMode` key in `chrome.storage.local` (not part of `Settings`, so it's never an unsaved edit), **default ON**. While on, the content script blocks every order click on checkout pages, even with the interceptor disabled or setup unfinished, and also catches order buttons that `CHECKOUT_SELECTORS` misses by their label (`ORDER_LABEL`: place order, buy now, submit/complete order, pay now; whitespace-collapsed). Nothing can be ordered. Turn it to Live only on purpose.
*   **Enabled/Disabled switch:** pauses the interceptor without uninstalling the extension or losing settings. It flips only the persisted `settings.active` (unsaved draft edits are untouched), and open checkout tabs pick up the change live.
    *   **Disabling** requires confirming in a dialog ("Keep it on" is the focused default). This is deliberate friction: turning it off is the easy escape for an impulse buyer.
    *   **Enabling** is immediate.
    *   The switch is unavailable until a complete setup has been saved once (`selectCanEnable`).
    *   We don't use `chrome.management.setEnabled`: it needs an extra permission, and a disabled extension can't re-enable itself from its own popup.
*   **Persistence:** `src/settings.ts` holds the `Settings` type and `loadSettings`/`saveSettings`/`onSettingsChanged`, all on `chrome.storage.local`. The content script applies changes live. Unsaved popup edits are lost when the popup closes (Chrome closes popups on blur).

### 3.3 Backend (`server/`, FastAPI)
*   **Layout:** routes in `app.py` stay thin (load state → call pure functions → save state).
    *   `score.py`: pure functions only (no I/O, LLM or randomness). `compute_components`, `decide`, `evaluate` (returns the "facts" dict).
    *   `snapshot.py`: `get_financial_snapshot()` is the only way anything reads finances. Returns `{ balance, bills_14d, spent_this_month, transactions }`.
        *   `transactions` = seeded rows from `data/seed_snapshot.json` (they sum to $150, the worked example) + simulated purchases, newest first, latest 10. Each is `{ id, merchant, category, amount, timestamp (ms), simulated }`.
        *   `spent_this_month` = seeded rows + simulated purchases dated this month. `balance` = source balance − simulated purchases (neither source deducts them).
        *   `DATA_SOURCE=seed` (default): balance/bills from the seed file; simulated purchases in `data/purchases.json` (git-ignored).
        *   `DATA_SOURCE=nessie`: balance from the account in `data/nessie_ids.json`, bills = pending/recurring bills due in the next 14 days, simulated purchases = the account's Nessie purchases minus `ignored_nessie_purchases` in `state.json`.
        *   `record_simulated_purchase(title, price)` writes to whichever source is active.
    *   `nessie.py`: thin httpx client. Errors are re-raised as `NessieError` without the URL, because the URL carries the API key.
    *   `llm.py`: `explain(facts)` and `chat(facts, title, history)`. Both pass only `public_facts` (price, balance_after, bills_14d, bills_window_days, budget_left_after, action) to Claude, through `_grounded_or`, which falls back to `template_message` when there's no key, the API errors, Claude refuses, `numbers_are_grounded` fails, or `mentions_internals` matches. The persona and per-verdict instructions live in `SYSTEM` / `CHAT_SYSTEM`.
    *   `store.py`: reads/writes `data/state.json` (settings, `regret_penalty`, `blocks_this_week`) and `data/commitments.json`, via temp file + rename. Both files are git-ignored and recreated from defaults.
*   **Endpoints:**
    *   `GET /health` → `{ ok: true, source }`, where `source` is `{ type: "seed" }` or `{ type: "nessie", customer_id, account_id, customer_name }` (local files only, no Nessie call). The same `source` is in every snapshot, and the overlay shows it at the bottom of the left panel (`DataSourceBadge`).
    *   `POST /evaluate` `{ title, price, quantity?, category? }` → `{ action, message, snapshot }`, where `snapshot` is `{ budget, spent_this_month, balance, transactions, source }` for the UI. `?debug=true` adds `debug` with the full facts (`score_before`, `score_after`, `components_after`, `floor`, …) for development; the extension never asks for it.
    *   `POST /purchase` `{ title, price }` → `{ snapshot }`. **SIMULATED** "Buy anyway": records a fake purchase so the ledger and the next score reflect it. Nothing is ordered anywhere.
    *   `POST /chat` `{ purchase, history: [{ role: user|assistant, content }] }` → `{ reply, done }`. History must end with a user turn. On the user's `MAX_USER_TURNS`th (3rd) reply, Claude gets `llm.FINAL_TURN`: sum up, hand them the decision (buy anyway or walk away), no question, never mention a limit; the response has `done: true`. More than 3 user turns returns `llm.closing_message` with `done: true` without calling Claude. Facts are recomputed server-side, never taken from the client.
    *   `GET|PUT /settings` `{ budget, buffer_target, mode: aware|strict, floor }`.
    *   Stubs (TODO): `POST /commit`, `GET /followups`, `POST /outcome`, `POST /demo/skip-week`.
*   **Planned, not built:** a richer snapshot for the UI (`monthly_income`, `fixed_bills`, `days_until_payday`, `recent_transactions` for the Recent Ledger: latest ~10 Nessie `/purchases`, each `{ id, merchant, category, amount, timestamp }`, with `category` one of `shopping | transport | coffee | groceries | dining | subscriptions` to match `TransactionCategory` in `extension/src/store.ts`); signed unblock tokens; SSE streaming.

### 3.4 Capital One Nessie Integration
*   **Base URL:** `https://prod-api.nessieisreal.com` (set by `NESSIE_BASE`). Auth via `?key=` from `NESSIE_KEY` in `server/.env`. Everyone shares one sandbox, so use unique fake names and no real data.
*   **Verified behaviour:**
    *   Creates return `{ code: 201, objectCreated: { _id, ... } }`; IDs are UUIDs (not 24-char ObjectIds).
    *   `GET/POST /accounts/{id}/purchases` work; a purchase needs a `merchant_id`. Merchant `category` must be a string, not a list.
    *   **Purchase `amount` is stored as a whole number** (1.23 → 1). We keep the exact price and time in `description` as `SIMULATED | <title> | <price> | <timestamp ms>` and parse it back (`parse_nessie_purchase`).
    *   Neither deposits nor purchases change the account `balance`.
    *   **`DELETE /purchases/{id}` returns 403**, so `reset_demo.py` hides existing purchases by ID instead of deleting them.
*   **Seeding:** `server/scripts/seed_nessie.py` creates a fresh fake customer (Test Student####), a $1400 checking account, a $900 paycheck deposit, a $700 recurring rent bill and an "Amazon (demo)" merchant, then writes the IDs to `server/data/nessie_ids.json` (committed; IDs aren't secret). Each run creates a new customer.
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

**Step 3: Claude wording (`llm.explain`).** Persona: a blunt but kind friend at checkout. Gets `public_facts` only, writes 2–3 plain sentences about bills, budget and balance: `inform` = "you're fine to buy this if you'd like" + one note on what it leaves, `nudge` = suggest sleeping on it, `block` = "this order is on hold" + one commitment question. Number guard, internals guard, template fallback (Rules 4–5).

**Step 4: Chat (`llm.chat`, `POST /chat`).**
*   Answers questions about this purchase in 1–3 sentences using the facts. It cannot approve, unblock or change the score, and says so when asked. It can't verify claims about how the item will be used.
*   **Hidden turn cap:** 3 user replies, enforced server-side and never shown. Rationale: past that point the user just circles until they buy, so the last reply wraps up and makes them decide right there.
*   The scraped item title is untrusted page text and is passed as data.

**Step 5: Follow-up loop (planned).** Commitments with a follow-up date; answers "used / returned / unused" adjust `regret_penalty` (+5 per returned/unused, max 15; −3 per used, min 0). "Saved" money counts only if a blocked/abandoned purchase isn't bought within 7 days; in the demo that time-skip is SIMULATED and labeled.

---

## 5. Status & Next Steps
Done: overlay UI, interception, service-worker proxy, score engine + tests, seed/Nessie snapshot, Claude explanation + chat with number guard, Nessie seed script, server-driven donut and Recent Ledger, simulated "Buy anyway" purchases (seed file or Nessie).
Next, roughly in order:
1.  "Sleep on it" and "Make a commitment" buttons, and a settings UI (mode, floor, budget, buffer).
2.  `/commit`, `/followups`, `/outcome`, `/demo/skip-week`, so the same cart shows a changed score after a follow-up.
3.  Drive the Income & Allocation card from server data (needs monthly income and fixed bills in the snapshot).
4.  Polish: score gauge, cooldown, streaming.

---

## 6. Repository Layout & Commands
```
CLAUDE.md
.gitignore                 # .env, .venv, node_modules, dist, server/data/state.json + commitments.json
extension/                 # Manifest V3 extension + React overlay (Vite + CRXJS)
  manifest.json            # Source manifest; CRXJS rewrites it into dist/
  vite.config.ts
  tailwind.config.js       # Surfaces `base`/`panel`; brand colors `spent`/`purchase`/`savings` (mirror src/theme.ts)
  src/
    content.tsx            # Interception, activation gate, scraping, Shadow DOM mount (entry point)
    background.ts          # Service worker: the only code that calls the backend
    api.ts                 # callServer() + request/response types for the service worker
    settings.ts            # Settings type + chrome.storage helpers shared by popup and content script
    api/bank.ts            # Simulated Nessie OAuth (mock accounts) — replace with backend calls
    popup/                 # Toolbar popup: index.html, main.tsx, Popup.tsx, store.ts, components/
    App.tsx                # Overlay shell (dark theme), two-panel layout, slide-in animation
    store.ts               # The single Zustand store (mock snapshot, ledger, evaluation, chat, verdict)
    format.ts              # formatUsd / formatPercent / formatTimeAgo
    theme.ts               # CHART_COLORS: the only source of data-viz colors
    index.css              # Tailwind entry, injected into the shadow root via ?inline
    components/            # BudgetDonut, IncomeAllocation, AllocationBar (shared w/ popup), RecentLedger, ChatPanel, SimulatedBuyButton, DataSourceBadge
shop/checkout/index.html   # Mock Amazon checkout (same IDs/classes the extension uses), served on localhost:5500
server/                    # FastAPI backend (see 3.3)
  app.py score.py snapshot.py nessie.py llm.py store.py
  data/                    # seed_snapshot.json, nessie_ids.json (+ git-ignored state.json, commitments.json, purchases.json)
  scripts/                 # seed_nessie.py, reset_demo.py, nessie_customer.py, show_nessie.py
  tests/                   # test_score.py, test_chat.py, test_purchases.py
  .env.example             # copy to server/.env (git-ignored)
```
Run from `extension/`:
*   `npm run dev`: dev build with HMR into `dist/`. The dev server **must keep running**; the dev `dist/` loads code from `localhost:5173`.
*   `npm run build`: typecheck (`tsc -b`) plus a standalone production build into `dist/`.
*   `npm run typecheck`: types only. Must pass before any change is considered done.
*   Load in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`. After a rebuild, click reload on the extension card and refresh the Amazon tab. Then click the extension's toolbar icon and finish setup. **The interceptor does nothing until you click "Save & Activate".** After moving or renaming the project folder, remove the extension and load it again (Chrome tracks unpacked extensions by absolute path, and the extension ID changes).

Run from `server/` (one-time setup: `python -m venv .venv`, then `.venv/Scripts/python -m pip install -r requirements.txt`, then copy `.env.example` to `.env`):
*   `.venv/Scripts/python -m uvicorn app:app --port 3001 --reload`: start the backend.
*   `.venv/Scripts/python -m pytest`: run the tests. Must pass before any backend change is considered done.
*   `.venv/Scripts/python scripts/reset_demo.py`: restore default settings, clear commitments and hide all simulated purchases (both modes); run before every rehearsal.
*   `.venv/Scripts/python scripts/seed_nessie.py`: create a new fake Nessie customer and update `data/nessie_ids.json`.
*   `.venv/Scripts/python scripts/nessie_customer.py list | show <id> | use <id>`: list every customer the key can see (all fields + accounts), dump one customer's accounts/bills/deposits/purchases, or switch the server to that customer (live, no restart). `scripts/show_nessie.py` = `show` for the current customer.
*   Nessie deletes (tested on a throwaway customer): bills, deposits and accounts can be deleted; **purchases and customers cannot** (no such route). Never call bulk `DELETE /data`: it wipes the demo customer too.

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
*   **One Zustand store per surface**: `src/store.ts` for the overlay, `src/popup/store.ts` for the popup (separate JS contexts that share state only through `chrome.storage`). Components read with narrow selectors (`useInterceptorStore((s) => s.spent)`), never the whole store. Non-React code (the content script) uses `useInterceptorStore.getState()`.
*   State changes go through named store actions (`openIntercept`, `applySettings`, `applyEvaluation`, `pushMessage`, `sendChat`, `simulatePurchase`, `setDiscretionary`, …); components never call `setState` directly.
*   Backend calls go through `callServer()` in `src/api.ts`, never `fetch` from the content script or components.
*   Zustand v5: a selector that returns a new object or array (e.g. `selectAllocation`) **must** be wrapped in `useShallow`, or the component re-renders forever.
*   Money is a `number` in dollars; render it only through `formatUsd()` (and percentages through `formatPercent()`) from `src/format.ts`.

### Styling
*   **Dark theme only.** Surfaces: `bg-base` (#121212, overlay and popup background), `bg-panel` (#1e1e1e, cards/panels), `bg-zinc-800` (inputs, hovered rows, user bubbles); borders `border-zinc-700`/`zinc-800`. Text: `text-zinc-100` primary, `text-zinc-400` secondary/timestamps. Agent accents and primary buttons are amber (`amber-500` button with `text-zinc-950`, `amber-950/40` agent bubble); success is emerald; verdict badges use `<color>-500/10` fill + `<color>-300` text.
*   Tailwind utility classes only: no CSS modules, no inline `style` except for data-driven values (e.g. a chart color swatch).
*   Never write global selectors (`body`, `html`, `*`) in `index.css`; the shadow root's document root is `:host`.
*   Every element is inside the shadow root, so `document.querySelector` cannot reach overlay elements. Use refs.

### Forms (popup)
*   Money inputs use `CurrencyInput`, which does **cash-register entry**:
    *   It always displays formatted currency (`$0.00` by default), and digits shift in from the right (4-5-0-0-0-0 → $4,500.00).
    *   Backspace drops the last digit, select-all followed by typing replaces the amount, and non-digits are ignored.
    *   Pasted text is read as a dollar amount ("$1,234.5" → $1,234.50).
    *   The caret is pinned to the end, except for select-all.
    *   Don't reintroduce a raw-on-focus/formatted-on-blur input. The earlier version had a selection race where fast typing appended ("1800" + "2000" → $18,002,000).
*   Range sliders are custom-drawn (`appearance-none` with a gradient fill and a `--thumb` color). Native `accent-color` gives gray accents a light track that clashes with the dark theme.

### Data Visualization
*   Chart colors come only from `CHART_COLORS` / `ALLOCATION_COLORS` in `src/theme.ts`: `#3987e5` spent/discretionary, `#d95926` this purchase, `#199e70` savings, zinc neutrals for remaining/fixed bills. They're validated for color-vision deficiency on the `panel` surface (#1e1e1e). **Only these three hues pass when all pairs are on screen together** (violet, magenta and yellow all failed against them), so any new category goes into a neutral or an existing hue. Re-run the validator for any change.
*   Recharts 3: `<Pie>` has no `activeIndex` prop and `activeShape` is deprecated. Keep hover state in React (`activeIndex` via `onMouseEnter`/`onMouseLeave`) and render sectors through the `shape` prop.
*   Every chart has a legend or value list, so meaning is never carried by color alone. Text stays in neutral ink, never the series color.
*   Keep chart entry animations ≤ 500 ms. The overlay must look complete within about 1 s of interception (Recharts' default of 1500 ms left the donut blank on first view).

---

## 8. Guardrails (Do / Don't)

### Safety: real money is at stake
*   **Keep the popup on Testing (the default) while developing and demoing.** It blocks order clicks even when a selector misses or the interceptor is paused. It cannot help if the content script never loads (wrong URL pattern, extension not reloaded), so the checks below still apply.
*   **Testing on live Amazon can place a real order.** If the content script fails to load or a selector misses, the click goes through. Before clicking "Place your order" on a live checkout, confirm that (1) the popup's switch shows **Enabled**, (2) `document.getElementById('devils-advocate-host')` exists in DevTools, and (3) the button matches `CHECKOUT_SELECTORS`. An inactive interceptor deliberately lets the order through. Prefer the mocked-page test (below) for every change. Turn off 1-Click on the demo account.
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
*   Keep `host_permissions` scoped to the checkout URLs plus `http://localhost:3001/*` (backend) and `http://localhost:5500/checkout/*` (mock checkout; also in `content_scripts.matches`). Don't widen to `https://www.amazon.com/*` or `<all_urls>`.
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
3.  **Mock checkout:** from the repo root run `python -m http.server 5500 --directory shop` (or the `mock-checkout` config in `.claude/launch.json`) and open `http://localhost:5500/checkout/` in the Chrome profile with the extension. `?price=20&title=...` presets the item; the Test controls change it live. It has 5 controls: the Amazon-ID button, an unlisted "Place your order" button, a "Buy Now" link and a script-submitted form (the last three caught only in Testing mode), plus "Add to Cart" (never caught). The page's own handlers log **red "ORDER WOULD HAVE BEEN PLACED"** when a click gets past the extension, and show whether the overlay host mounted. Expected: Testing mode blocks 1–4 even with the interceptor paused; Live + enabled blocks only 1; Live + paused blocks none.
    Then also route the checkout URL to a mock page with the checkout button and assert: overlay mounts, Amazon's own click/submit handlers did **not** fire, the page did not navigate, the verdict badge shows, and the first message switches to the server's score. Check both states: on a fresh profile (not activated) clicks **pass through**, and after activating via the popup they're intercepted using the saved settings.
4.  For popup changes, open `chrome-extension://<id>/src/popup/index.html` at 440×600. Drive it with real keystrokes (`keyboard.press` per digit, not just `fill`), switch tabs, and assert: the save button's enabled state, that each section fits without scrolling, and the stored `chrome.storage.local` value.
5.  Screenshot the overlay at desktop (≈1400px) and narrow (≈700px) widths, plus the popup, and actually look at them. Wait out CSS transitions (~400ms) first, or the screenshot shows half-applied states.

