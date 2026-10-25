# CLAUDE.md - Project Context & Requirements
**Project Name:** Amazon Purchase Interceptor ("Devil's Advocate")
**Domain:** Fintech / Behavioral Economics / Browser Extension
**Goal:** Intercept Amazon purchases at checkout and show what the purchase does to the user's finances, using a deterministic financial score built from their Capital One Nessie account data. Claude explains the score in plain language and answers questions about it; it never decides.

## 1. Core Philosophy & Architecture
**Rule 1: Fast Path Interception.** The intercept is one `POST /evaluate` call: a pure-function score plus one short Claude call (~1 s). The overlay opens immediately with a placeholder message (no numbers) and is replaced when the server answers.
**Rule 2: Secure by Design.** The extension contains NO API keys. All LLM calls and Nessie API keys live on the backend (`server/.env`). The extension talks to the server only through the background service worker.
**Rule 3: Checkout Only.** The intercept triggers ONLY on "Buy Now" and "Place your order" actions, NOT on "Add to Cart".
**Rule 4: The score decides, the LLM only words.** Verdicts (`inform` / `nudge` / `block`) come from `server/score.py`, which is deterministic and unit-tested. Claude receives money facts and the verdict and writes text; it cannot change the verdict, and every number in its output must appear in the facts (or the user's own messages) or the text is replaced with a template.
**Rule 5: The score is a hidden heuristic.** `/evaluate` returns `score_before` / `score_after` to the extension, which keeps them in `evaluation` for its own logic (e.g. deciding when the overlay should pop up) but **never renders them**. Claude never sees the score, its components, the floor or the mode (`llm.public_facts`), and its replies are rejected if they mention a score, rating, threshold, floor or algorithm (`llm.mentions_internals`). The user only ever hears about bills, budget and balance.
**Rule 6: Linking a bank is optional.** Without a bank (popup saved with no account), everything runs on the Finances tab and on purchases made through the extension: `manual.py`, a budget-only score, no balance anywhere (UI, facts, Claude). Linking an account or picking a customer switches back to Nessie.

---

## 2. Tech Stack & Dependencies
*   **Extension:** Manifest V3, content scripts, background service worker. Built with `@crxjs/vite-plugin` (2.0.0-beta) on Vite 6.
*   **Frontend UI:** React 18, TypeScript (strict), Zustand (state management), Recharts 3 (data visualization), Framer Motion (animations), lucide-react (icons), Tailwind CSS **v3** (see Guardrails: v4 breaks inside Shadow DOM).
*   **Backend:** Python 3.10+, FastAPI + uvicorn on port 3001. All financial data lives in Nessie; only agent preferences and bookkeeping are in local JSON files (no other database, no Redis). Dependencies in `server/requirements.txt`: fastapi, uvicorn[standard], httpx, python-dotenv, pydantic, anthropic, pytest. Responses are plain JSON (no SSE streaming yet).
*   **APIs:** Capital One Nessie API (mock banking), Anthropic Claude (wording and chat only). Model set by `ANTHROPIC_MODEL` in `server/.env`.

---

## 3. Component Specifications

### 3.1 Browser Extension (Manifest V3)
*   **Checkout URLs:** Amazon serves checkout at `https://www.amazon.com/checkout/*` (current "Chewbacca" pipeline, e.g. `/checkout/p/p-<id>/spc`) and the legacy `https://www.amazon.com/gp/buy/spc/handlers/display.html*`. `manifest.json` `host_permissions` and `content_scripts.matches` must list both and stay in sync. `host_permissions` also lists `http://localhost:3001/*` for the backend.
*   **DOM Interceptor:** Content script listens for clicks on checkout buttons (`#placeYourOrder1`, `#submitOrderButtonId`, `#bottomSubmitOrderButtonId`, or exact "Buy Now" selectors). Selectors live in one `CHECKOUT_SELECTORS` list in `src/content.tsx`. "Buy Now" is not yet implemented.
*   **Scraper:** On click, `preventDefault()` is called. Scrape **every line item** into an `InterceptedCart` `{ items: [{ name, price, quantity, imageUrl }], total }` (`imageUrl` `https://` only; `category` not scraped yet). Each title match is one item; its row is the largest ancestor (≤ 8 levels) holding no other item's title, and price/quantity/image are read inside that row (a lone item's quantity may come from anywhere on the page). **Verified on the live checkout:** item price is `.apex-price-to-pay-value .a-offscreen` ("$28.99"; the visible text is split into `$`/`28`/`.`/`99` spans, so never parse it), and quantity is the stepper's `<span data-a-selector="inner-value">4</span>`. Item prices come only from known price elements, never from a row's loose text: rows also contain unrelated `a-price`s such as the Prime upsell's $14.99. If the line prices add up to the summary subtotal only without multiplying by quantity, they're treated as line totals and divided. Quantity, most reliable first: the stepper, a `<select>` whose options are all whole numbers (Amazon's dropdown, named or not), a quantity `<input>`, an `aria-label`/`aria-valuenow` stepper, then "Qty/Quantity: N" text. Read text with `visibleText()`, never `textContent`: the dropdown's hidden `<option>`s turn "Qty: 2" into 123456789102. Missing quantities are filled from the summary's "Items (N):" count, or a lone item's subtotal ÷ unit price. The content script logs `[devils-advocate] scraped cart` to the page console. `total` is what gets scored: the order summary's "Items:" subtotal (found by its label text, so class renames don't break it), then the sum of line items if every one has a price, then the grand total / "Order total:" row. The server gets one title naming every item (`cartTitle`, e.g. "2× Charger; Standing Desk"). If none is found the price stays `null`: the overlay says "Price not found on this page", no score is requested, and the lock holds. There is no mock fallback price. A missing title becomes "Your Amazon order". `category` is not scraped yet, and the image selectors are unverified against the live Chewbacca checkout.
*   **Activation gate:** The content script only intercepts while `settings.active` is true: it's set by **Save & Activate** in the popup and cleared by the popup's Disable switch. Until `chrome.storage` answers, it intercepts anyway (fail closed). If storage can't be read, it keeps intercepting.
*   **Shadow DOM Root:** Mount the React application inside a Shadow DOM to completely isolate it from Amazon's global CSS.
*   **Toolbar Popup (Configuration):** `action.default_popup` → `src/popup/index.html`, shown when the user clicks the extension icon. See 3.2.1.
*   **Service Worker (`src/background.ts`):** Proxies every backend call (content scripts on https pages can't reliably fetch `http://localhost`). Callers use `callServer()` from `src/api.ts`, which sends a typed `ServerRequest` message (`evaluate`, `chat`, `purchase`, `accounts`, `getProfile` or `saveProfile`) and resolves with the server's JSON. Server errors come back with FastAPI's `detail` text when there is one. No auth session yet.

### 3.2 Frontend (React UI)
*   **State:** Use a single `Zustand` store for charts, chat history, and verdict state. Every number the left panel draws comes from the server: `finances` (`monthlyIncome`, `fixedBills`, `savings`, `budget` = discretionary, `spent`, `ledger`) is `null` until `/evaluate` answers (`applyEvaluation`), and `/purchase` refreshes it (`buy`). While it's `null`, each card shows `FinancesPlaceholder` ("Loading from your bank…", or "Couldn't load your bank data." after `failEvaluation`). There is no mock financial data. The server's result lives in `evaluation`. Only `intensity` comes from the popup's saved settings (`applySettings`); the income split comes from Nessie, which is where the popup saved it. `dataSource` comes from each snapshot's `source` (shown by `DataSourceBadge`).
*   **Theme:** Dark overlay (see 7. Code Style → Styling for the exact palette).
*   **Animations:** Use `Framer Motion` for a smooth slide-in/fade-in of the overlay.
*   **Layout:** Two-panel split view sliding in from the right (stacks vertically below the `md` breakpoint).
    *   **Left Panel (Data/Vis), three cards top to bottom:**
        *   **Cart + Income & Allocation card:** every cart item (`CartItems`: thumbnail, title, quantity, line price when there are several), then the item count and scored total; below it monthly income and a horizontal stacked `div` bar splitting income into Fixed bills / Savings / Discretionary, with a labeled legend.
        *   **Monthly budget utilization card:** Recharts donut of the discretionary budget: Spent → *This purchase* (distinct, contrasting slice placed right after Spent) → Remaining, with a legend beside it. Hovering a slice or legend row expands that slice, dims the others, and shows a tooltip with name, amount and % of budget (e.g. "This purchase: $179.99 (22%)").
        *   **Recent Ledger (Transaction History) card:** scrollable list of recent Nessie purchases: category icon avatar, merchant + relative time, right-aligned negative amount. It fills the remaining panel height.
        *   *Not yet built:* Recharts bar chart of income vs. monthly spending pacing; a score gauge.
    *   **Right Panel (Agent/Chat):**
        *   Pinned verdict badge at the top, mapped from `/evaluate`'s action: `inform` → `[ Approved ]` (under the threshold: the overlay still opens, but says they're fine to buy it), `nudge` → `[ Negotiating ]`, `block` → `[ Blocked ]`.
        *   Testing-mode banner under the header (`TestModeBanner`) while testing mode is on.
        *   Chat window. The first agent message is Claude's explanation (money only, no score; Rule 5). Replies arrive whole (not streamed). Agent bubbles are amber-tinted; user bubbles are zinc.
        *   User input: enabled once `evaluation` is set, disabled while the agent is replying, and closed (`chatClosed`, placeholder "Time to decide.") when `/chat` returns `done: true`. **The reply cap is hidden:** the extension doesn't know or show it, so there's no countdown to bargain against. Enter sends, Shift+Enter adds a newline. Sending goes through the store action `sendChat`.
        *   **How the student decides** (no extra buttons; `DecisionBar` is just a hint line): closing the overlay (X / outside) returns to the checkout with the decision still open. **Clicking Place your order again for the same cart** (`content.isConfirmingPurchase`, matched by cart title + total) is the decision to buy: `confirmPurchase` records the purchase (Nessie, or the Finances-tab log) and logs `bought`. In **Testing mode** that click is blocked, so nothing is ordered, and a toast confirms it (`NoticeToast`); in **Live mode** the click goes on to Amazon. **Left checkout** (still deciding, not a "no") is logged when they check out a different cart, or on `pagehide` (best effort).
        *   **Live-mode pass-through** (`content.tsx`): a confirmed click opens a ≤1.5 s window so its form submit reaches Amazon; it closes as soon as that submit passes, so a further click is intercepted again. The order goes through only on the student's second, explicit Place Order click, never because of a verdict.
        *   *Not yet built:* "Sleep on it 24h" and "Make a commitment" buttons; cooldown.

### 3.2.1 Configuration Popup (`src/popup/`)
*   Fixed 440×600 page (Chrome's popup maximum height is 600px), same dark tokens as the overlay. The header has an **Enabled/Disabled switch** (see below). Below it, a tab bar (**1 Account · 2 Finances · 3 Agent**) shows **one section at a time**, each tab with a completion check (green) or a needs-attention dot (amber). Tabs follow the WAI-ARIA pattern (`role="tab"`, arrow-key navigation). The save bar stays pinned to the bottom.
*   **No scrolling:** each section must fit the panel area (≈384px between the tabs and the save bar). Check `main.scrollHeight <= clientHeight` when changing a section's content.
*   **Navigation:** the popup opens on the first incomplete section. Linking a bank during first-time setup moves on to Finances. When saving is blocked by a field on another tab, the hint under the save button links to that tab.
*   **Account Connection:** an amber "Connect Bank Account" button opens a Capital One / Nessie sign-in modal (`src/api/bank.ts`). The account list is the demo customer's real Nessie checking accounts (`GET /accounts`); only the sign-in step is simulated (Nessie has no OAuth). Linking prefills an empty Finances tab with what the bank holds (`GET /profile?account_id=`). Once linked, it shows a green "Linked: <nickname> ending in ****1234" with a Disconnect link. **Never** add a credential or API-key field: the real flow goes through the backend, and the extension stores only `{ id, nickname, last4 }`.
*   **Customer dropdown** (`CustomerPicker`, top of the Account tab; dev/demo control): lists the Nessie customers the key can see (`GET /customers`) and switches the server to one (`PUT /customer`). **Config is per customer:** finances live in Nessie on that customer's account, and the linked account and intensity are kept per customer on the server, so switching loads theirs into the popup (`switchCustomer`). Save sends the intensity with the finances.
*   **Financial Baseline & Allocation (Finances tab):** a large monthly net income input, a live `AllocationBar` preview, and a currency input plus slider for Fixed Bills (gray), Savings (green) and Discretionary (blue).
    *   **Rebalancing:** editing income, fixed bills or savings auto-fills discretionary with the remainder. A manual discretionary override rebalances **savings only**; fixed bills are real obligations and never move automatically.
    *   **Validation:** math is done in whole cents. Over-allocation shows a hatched red tail on the bar and blocks saving.
*   **Agent Intervention:** a three-card radiogroup: Light / The Gentle Nudge (yellow caution icon), Medium / The Negotiator (amber scales, default), Harsh / The Interrogator (red flame). Harsh's cooling-off rule comes from `HARSH_COOLDOWN` in `src/settings.ts` (5 minutes, over 10% of the budget). The intensity currently only changes the placeholder line shown before the score arrives; the real prompt and cooldown behavior arrive with the backend.
*   **Save bar:** saving sends the Finances tab (and the linked account, if any) to `PUT /profile`. With an account it's written to Nessie (bank mode); with none, the server keeps it and scores from the Finances tab alone (Rule 6). The account link is optional: Save & Activate and the Enabled switch only need a balanced split of a positive income. The server's read-back is what gets stored in `chrome.storage`; an error shows in the save bar.
*   **Testing / Live switch** (`TestModeSwitch`, under the Enabled switch): stored as its own `testMode` key in `chrome.storage.local` (not part of `Settings`, so it's never an unsaved edit), **default ON**. While on, the content script blocks every order click on checkout pages, even with the interceptor disabled or setup unfinished, and also catches order buttons that `CHECKOUT_SELECTORS` misses by their label (`ORDER_LABEL`: place order, buy now, submit/complete order, pay now; whitespace-collapsed). Nothing can be ordered. Turn it to Live only on purpose.
*   **Enabled/Disabled switch:** pauses the interceptor without uninstalling the extension or losing settings. It flips only the persisted `settings.active` (unsaved draft edits are untouched), and open checkout tabs pick up the change live.
    *   **Disabling** requires confirming in a dialog ("Keep it on" is the focused default). This is deliberate friction: turning it off is the easy escape for an impulse buyer.
    *   **Enabling** is immediate.
    *   The switch is unavailable until a complete setup has been saved once (`selectCanEnable`).
    *   We don't use `chrome.management.setEnabled`: it needs an extra permission, and a disabled extension can't re-enable itself from its own popup.
*   **Persistence:** `src/settings.ts` holds the `Settings` type and `loadSettings`/`saveSettings`/`onSettingsChanged`, all on `chrome.storage.local`. The content script applies changes live. Nessie is the source of truth for the finance fields: on open, `hydrate` re-reads `GET /profile` for the linked account and re-syncs `chrome.storage` (unless the user already started editing); offline, the stored copy stays. Unsaved popup edits are lost when the popup closes (Chrome closes popups on blur).

### 3.3 Backend (`server/`, FastAPI)
*   **Layout:** routes in `app.py` stay thin (load state → call pure functions → save state). Nessie is the only source of financial data; there is no offline/seed mode.
    *   `score.py`: pure functions only (no I/O, LLM or randomness). `compute_components`, `decide`, `evaluate` (returns the "facts" dict).
    *   `finances.py`: the financial profile in Nessie (see 3.4 for the record mapping). `get_profile(account_id)` / `save_profile(account_id, income, fixed_bills, savings)`, `profile_from(...)` (pure), `monthly_bills(bills)`, `linked_account_id()` (`state.account_id`, else the seeded account), `checking_accounts()`, `account_summary()` (`{ id, nickname, last4 }`, the only account fields the extension sees).
    *   `snapshot.py`: `get_financial_snapshot()` is the only way anything reads finances. Returns `{ balance, monthly_bills, monthly_income, savings, budget, spent_this_month, transactions, source }`; the Nessie reads run in parallel (warm ≈ 0.2 s).
        *   `budget` = discretionary = income − fixed bills − savings, from the profile. There is one budget, and it's what the user saved in the popup.
        *   `transactions` = the account's Nessie purchases minus `ignored_nessie_purchases` in `state.json`, newest first, latest 10. Each is `{ id, merchant, category, amount, timestamp (ms), simulated }`, with merchant name/category looked up via `GET /merchants/{id}` (cached per process); unknown categories become `shopping`.
        *   `spent_this_month` = purchases dated this month. `balance` = Nessie balance − simulated purchases (Nessie never deducts purchases; seeded spending is already reflected in the starting balance).
        *   `record_simulated_purchase(title, price)` creates a purchase on the linked account at the Amazon.com merchant.
    *   `demo_data.py`: `seed_customer(seed, last_name)` and `reset_demo()`, shared by the scripts and the tests.
    *   `customers.py`: `list_customers()` and `select_customer(id)`, which rewrites `nessie_ids.json` (customer, checking, savings; the demo merchant carries over). Refuses a customer with no checking account.
    *   `manual.py`: Finances-tab-only mode. `bank_linked()` (state.json `bank_linked`, default true) picks the data source for every route (`app._snapshot`, `app._profile_key`). Stores the tab's plan and the purchases made through the extension under `state.json` → `manual`; `snapshot()` has the usual shape with `balance: None` and `source: { type: "manual" }`. Decision log and intensity use the profile key `"manual"`.
    *   `decisions.py`: the per-customer decision log. `record(title, price, outcome, history)` stores `{ title, price, outcome: bought|left_checkout, summary, timestamp }` (last 50), with `summary` from `llm.summarize_decision` (1-2 lines: what they did and their own stated reason; template fallback). `relevant(title)` returns up to 3 summaries for a similar item (word overlap ≥ 50% of the shorter title, `similar()`), newest first.
    *   `nessie.py`: thin client on one pooled `httpx.Client`. Errors are re-raised as `NessieError` without the URL, because the URL carries the API key; routes turn them into a 502. A trailing slash in `NESSIE_BASE` is stripped.
    *   `llm.py`: `explain(facts, intensity)` and `chat(facts, title, history, final, intensity)`. Prompts are built from `ROLE` + a persona from `PERSONAS` (the popup's Agent setting, saved per customer: light = The Gentle Nudge, medium = The Negotiator, harsh = The Interrogator) + `STANCE` + `INFORM` + `ANGLES` + `LINKING` (+ `CHAT_INSTRUCTIONS`, + `FINAL_TURN` on the last reply) + `RULES` (`system_prompt` / `chat_system_prompt`). Claude gets only `public_facts`: price, balance_after, monthly_bills, budget_left_after, action, `recent_purchases` (last 8 as `{ merchant, category, amount, when, item? }`, with `item` when we know the product, i.e. purchases made through the extension in no-bank mode, with `when` written out by the server, e.g. "2 days ago"), `past_decisions`, and `angles_used` (not populated yet). Everything goes through `_grounded_or`, which falls back to a template when there's no key, the API errors, Claude refuses, `numbers_are_grounded` fails, or `mentions_internals` matches.
    *   `store.py`: reads/writes `data/state.json` (global: settings, `regret_penalty`, `blocks_this_week`, `ignored_nessie_purchases`; per customer under `customers[<customer_id>]`: linked `account_id`, `intensity`, `decisions`) and `data/commitments.json`, via temp file + rename. Both files are git-ignored. `reset_demo` restores defaults, which also clears every customer's decision log and links.
*   **Endpoints:**
    *   `GET /health` → `{ ok: true, source }`, where `source` is `{ type: "nessie", customer_id, account_id, customer_name }` for the linked account (local files only, no Nessie call). The same `source` is in every snapshot, and the overlay shows it at the bottom of the left panel (`DataSourceBadge`).
    *   `POST /evaluate` `{ title, price, quantity?, category? }` → `{ action, score_before, score_after, message, snapshot }`, where `snapshot` is `{ monthly_income, monthly_bills, savings, budget, spent_this_month, balance, transactions, source }` for the UI. The score is for the extension's logic only, never shown (Rule 5); `?debug=true` adds `debug` with the full facts (`score_before`, `score_after`, `components_after`, `monthly_bills`, `budget_left_after`, `floor`, …) for development and tests. The extension never asks for it.
    *   `POST /purchase` `{ title, price }` → `{ snapshot }`. **SIMULATED** "Buy anyway": records a fake purchase in Nessie so the ledger and the next score reflect it. Nothing is ordered anywhere.
    *   `POST /chat` `{ purchase, history: [{ role: user|assistant, content }] }` → `{ reply, done }`. History must end with a user turn. On the user's `MAX_USER_TURNS`th (3rd) reply, Claude gets `llm.FINAL_TURN`: sum up, hand them the decision (buy anyway or walk away), no question, never mention a limit; the response has `done: true`. More than 3 user turns returns `llm.closing_message` with `done: true` without calling Claude. Facts are recomputed server-side, never taken from the client.
    *   `GET /accounts` → `[{ id, nickname, last4 }]`: the demo customer's checking accounts (no balances).
    *   `GET /customers` → `{ current, customers: [{ id, name }] }`; `PUT /customer` `{ customer_id }` → `{ customer, profile }` (409 if they have no checking account).
    *   `POST /decision` `{ purchase, history, outcome: bought|left_checkout }` → the stored log entry; `GET /decisions` → this customer's log (dev). `/evaluate` and `/chat` add `past_decisions` (summaries for a similar item) to the facts Claude sees; they change wording only, never the verdict.
    *   `GET|PUT /profile` also carry `intensity` (saved per customer).
    *   `GET /profile[?account_id=]` → `{ account, monthly_income, fixed_bills, savings, discretionary }` as Nessie holds it, for the linked account or a preview of `account_id`. 404 if it isn't one of the customer's checking accounts.
    *   `PUT /profile` `{ account_id, monthly_income, fixed_bills, savings, discretionary }` → same shape, read back from Nessie after writing. Validated: income > 0, parts ≥ 0, and fixed + savings + discretionary = income in whole cents (422 otherwise). 409 if the account's other bills already exceed `fixed_bills`. Also links the account (`state.account_id`).
    *   `GET|PUT /settings` `{ buffer_target, mode: aware|strict, floor }`. The budget is not a setting; it comes from the profile.
    *   Stubs (TODO): `POST /commit`, `GET /followups`, `POST /outcome`, `POST /demo/skip-week`.
*   **Planned, not built:** `days_until_payday` in the snapshot (from the income deposit date); signed unblock tokens; SSE streaming.

### 3.4 Capital One Nessie Integration
*   **Base URL:** `https://prod-api.nessieisreal.com` (set by `NESSIE_BASE`). Auth via `?key=` from `NESSIE_KEY` in `server/.env`. Everyone shares one sandbox, so use unique fake names and no real data.
*   **Verified behaviour** (re-checked against the live sandbox; `tests/fake_nessie.py` reproduces it):
    *   Creates return `{ code: 201, objectCreated: { _id, ... } }`; IDs are UUIDs (not 24-char ObjectIds). Updates (`PUT /deposits/{id}`, `/bills/{id}`, `/accounts/{id}`) return 202.
    *   `GET/POST /accounts/{id}/purchases` work; a purchase needs a `merchant_id`. Merchant `category` must be a string, not a list.
    *   **Purchase and deposit `amount`, and account `balance`, are stored as whole numbers** (4500.25 → 4500). Bill `payment_amount` keeps cents. We keep exact amounts in `description` and parse them back.
    *   Neither deposits nor purchases change the account `balance`.
    *   **`DELETE /purchases/{id}` returns 403**, so `reset_demo.py` hides simulated purchases by ID instead of deleting them. DELETE works for bills and deposits.
    *   `POST /accounts/{id}/transfers` rejects the documented body (`payee_id`, `medium`: "extra fields not permitted"), so we don't use transfers.
    *   A trailing slash in the base URL makes every path `//...`, which returns 403 "Missing Authentication Token".
*   **How our data maps onto Nessie records:**
    *   Monthly income → a deposit on the linked checking account, description `INCOME | <amount>`.
    *   Fixed bills → the checking account's recurring bills (plus pending bills due this month) = `monthly_bills`. We own the recurring bill nicknamed `Fixed bills` and set it to the user's total minus any other bills.
    *   Monthly savings → a deposit on the customer's Savings account (created if missing), description `SAVINGS | <amount>`. Customer-wide, not per checking account.
    *   Discretionary → derived, never stored.
    *   Purchases → description `<SEED|SIMULATED> | <title or merchant> | <price> | <timestamp ms>` (`parse_nessie_purchase`; titles may contain ` | `).
*   **Seeding:** `server/scripts/seed_nessie.py` writes `data/seed_data.json` to Nessie: a fresh fake customer (Test Student####), a $1400 checking and a Savings account, one merchant per ledger category (Amazon.com → shopping, Uber → transport, Starbucks → coffee, Whole Foods Market → groceries, Netflix → subscriptions, Chipotle → dining), seven purchases summing to $150 (dated in the current month), and the profile $1500 income / $700 fixed bills / $400 savings (→ $400 discretionary). It writes the IDs to `server/data/nessie_ids.json` (committed; IDs aren't secret). Each run creates a new customer.

---

## 4. Score & Agent Design

**Step 1: Financial score (deterministic, `server/score.py`).**
*   **No bank linked (`compute_budget_only`):** `budget = clamp(100 × (budget − spent − price) ÷ budget)` (70%) and `size = clamp(100 × (1 − price ÷ budget))` (30%), minus `regret_penalty`. Worked example ($400 budget, $150 spent, $180 item): 74 → 29. Facts then carry `formula: "budget_only"` and no `balance_after`.
*   `balance_after = balance − price`; `left_after = budget − spent − price`.
*   `bills = clamp(100 × (balance_after / monthly_bills − 1))` (100 if no bills); `budget = clamp(100 × left_after / budget)`; `buffer = clamp(100 × (balance_after − monthly_bills) / buffer_target)`; each clamped to 0–100.
*   `score = 0.5 × bills + 0.3 × budget + 0.2 × buffer − regret_penalty[category]`, rounded. "Before" is the same with price 0. Worked example (seeded Nessie customer, $180 item): 89 → 62.
*   Weights are tunable defaults, not research. `budget` is the discretionary amount from the user's Nessie profile (popup); buffer target and floor are settings.

**Step 2: Verdict (`decide`).** The popup's Agent setting (saved per customer) picks the thresholds as well as Claude's persona (`score.INTENSITY_RULES`, `rules_for`):

| Agent setting | Mode | Nudge when | Blocks when |
|---|---|---|---|
| Light (The Gentle Nudge) | Aware | the score drops 25+ or ends below 40 | never |
| Medium (The Negotiator), default | Aware | drops 15+ or ends below 50 | never |
| Harsh (The Interrogator) | Strict | drops 15+ or ends below 50 | the score ends below the floor, 70 |

*   Otherwise the action is `inform` (Approved). After 3 blocks in a week, Strict behaves like Aware.
*   `PUT /settings` mode/floor no longer drive `/evaluate` or `/chat`; they're only the fallback for callers that pass no rules (`rules_from_settings`). `buffer_target` still comes from `/settings`.
*   The user can always override: closing the overlay and clicking Place your order again is always allowed.

**Step 3: Claude wording (`llm.explain`).** A sharp, warm friend who argues the case against the purchase from the student's own money and history, in the persona the student picked. It picks the single strongest angle (already bought something similar, price vs. what's left, opportunity cost, want vs. need, why now, how a past purchase went, cost per use) and links the item to `recent_purchases` / `past_decisions` only when the facts support it. `inform` = "you're fine to buy this if you'd like" + one note, `nudge` = one real doubt, `block` = a clear position against it. Number guard, internals guard, template fallback (Rules 4–5).

**Step 4: Chat (`llm.chat`, `POST /chat`).**
*   Answers questions about this purchase in 1–3 sentences using the facts. It cannot approve, unblock or change the score, and says so when asked. It can't verify claims about how the item will be used.
*   **Hidden turn cap:** 3 user replies, enforced server-side and never shown. Rationale: past that point the user just circles until they buy, so the last reply wraps up and makes them decide right there.
*   The scraped item title is untrusted page text and is passed as data.

**Step 5: Follow-up loop (planned).** Commitments with a follow-up date; answers "used / returned / unused" adjust `regret_penalty` (+5 per returned/unused, max 15; −3 per used, min 0). "Saved" money counts only if a blocked/abandoned purchase isn't bought within 7 days; in the demo that time-skip is SIMULATED and labeled.

**Step 6: Decision memory.** Every finished checkout is logged per customer: `bought` when the student closes the overlay and clicks Place your order again for the same cart (`confirmPurchase`), `left_checkout` when they check out a different cart or leave the page (not a "no": they may still be deciding or saving it for later; older `walked_away` entries are read the same way) (`logDecision`, once per checkout). Claude summarizes the chat into 1-2 lines with the outcome and the student's reason. On a later checkout of a similar item, those lines go to Claude as `past_decisions`, so it can say e.g. "last time you held off on these until after rent". Same guards as all LLM text (numbers, internals).

---

## 5. Status & Next Steps
Done: overlay UI, interception, service-worker proxy, score engine + tests, Nessie as the only data source (profile, bills, purchases with merchant categories), popup finances saved to and read back from Nessie, Claude explanation + chat with number guard, Nessie seed script, fully server-driven left panel (allocation, donut, ledger), simulated "Buy anyway" purchases in Nessie.
Next, roughly in order:
1.  "Sleep on it" and "Make a commitment" buttons, and a settings UI (mode, floor, buffer).
2.  `/commit`, `/followups`, `/outcome`, `/demo/skip-week`, so the same cart shows a changed score after a follow-up.
3.  Polish: score gauge, cooldown, streaming.

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
    api/bank.ts            # Account linking: real Nessie accounts via GET /accounts; the sign-in step is simulated
    popup/                 # Toolbar popup: index.html, main.tsx, Popup.tsx, store.ts, components/
    App.tsx                # Overlay shell (dark theme), two-panel layout, slide-in animation
    store.ts               # The single Zustand store (server finances, evaluation, chat, verdict)
    format.ts              # formatUsd / formatPercent / formatTimeAgo
    theme.ts               # CHART_COLORS: the only source of data-viz colors
    index.css              # Tailwind entry, injected into the shadow root via ?inline
    components/            # BudgetDonut, IncomeAllocation, AllocationBar (shared w/ popup), RecentLedger, FinancesPlaceholder, CartItems, ChatPanel, DecisionBar, NoticeToast, TestModeBanner, DataSourceBadge
server/                    # FastAPI backend (see 3.3)
  app.py score.py finances.py snapshot.py manual.py customers.py decisions.py demo_data.py nessie.py llm.py store.py
  data/                    # seed_data.json, nessie_ids.json (+ git-ignored state.json, commitments.json)
  scripts/                 # seed_nessie.py, reset_demo.py, nessie_customer.py, show_nessie.py
  tests/                   # fake_nessie.py (in-memory Nessie), test_score.py, test_finances.py, test_purchases.py, test_chat.py, test_customers_and_memory.py, test_prompts.py, test_manual_mode.py, test_nessie_live.py
  .env.example             # copy to server/.env (git-ignored)
```
Run from `extension/`:
*   `npm run dev`: dev build with HMR into `dist/`. The dev server **must keep running**; the dev `dist/` loads code from `localhost:5173`.
*   `npm run build`: typecheck (`tsc -b`) plus a standalone production build into `dist/`.
*   `npm run typecheck`: types only. Must pass before any change is considered done.
*   Load in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`. After a rebuild, click reload on the extension card and refresh the Amazon tab. Then click the extension's toolbar icon and finish setup. **The interceptor does nothing until you click "Save & Activate".** After moving or renaming the project folder, remove the extension and load it again (Chrome tracks unpacked extensions by absolute path, and the extension ID changes).

Run from `server/` (one-time setup: `python -m venv .venv`, then `.venv/Scripts/python -m pip install -r requirements.txt`, then copy `.env.example` to `.env` and set `NESSIE_KEY`). On macOS/Linux the venv interpreter is `.venv/bin/python`.
*   `.venv/Scripts/python -m uvicorn app:app --port 3001 --reload`: start the backend.
*   `.venv/Scripts/python -m pytest`: run the tests (against an in-memory fake Nessie seeded from `data/seed_data.json`). Must pass before any backend change is considered done.
*   `NESSIE_LIVE=1 .venv/Scripts/python -m pytest tests/test_nessie_live.py`: the same round trip against the real sandbox (creates a throwaway customer; ~30 s).
*   `.venv/Scripts/python scripts/reset_demo.py`: restore default settings and the seed profile in Nessie, clear commitments, and hide simulated purchases (seeded ones stay); run before every rehearsal.
*   `.venv/Scripts/python scripts/seed_nessie.py`: create a new fake Nessie customer and update `data/nessie_ids.json`.
*   `.venv/Scripts/python scripts/seed_test_students.py`: create the five test students from `data/test_students.json` (SteadySaver, RentCrunch, OverBudget, ImpulseShopper, FreshPaycheck: one per money situation) and print each one's verdicts at $60 / $180 / $600. Leaves the current customer unchanged; switch with the popup's Customer dropdown.
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
*   State changes go through named store actions (`openIntercept`, `applySettings`, `applyEvaluation`, `pushMessage`, `sendChat`, `buy`, `setDiscretionary`, …); components never call `setState` directly.
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
*   Interception must **fail closed on recognized buttons**: call `preventDefault()` and `stopImmediatePropagation()` *before* any async work, scraping, or code that could throw. If the server or Nessie is down, the overlay says so (`failEvaluation`) and the lock still holds.
*   Intercept with **capture-phase listeners on `window`** (`click` and `submit`) using `closest()` delegation, not listeners attached to the button. Amazon re-renders the checkout DOM (address/payment changes) and runs its own handlers on the button.
*   Never intercept "Add to Cart" or any non-checkout action (Rule 3).
*   Only fake or Nessie sandbox data. No real card numbers or personal information anywhere.

### Security
*   No API keys, secrets, or backend tokens in `extension/` (Rule 2). Everything in the bundle is public. Keys live only in `server/.env`, which is git-ignored; never print them (Nessie URLs contain the key).
*   The verdict comes from the server's score, never from client state or from the LLM. The checkout lock lets an order through only on the student's second, explicit Place your order click in Live mode (the user can always override), never because of a verdict or `verdictStatus === 'approved'`. Never in Testing mode.
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
*   `server/.env` is read only at startup: restart uvicorn after editing it (`--reload` only watches code). The server needs `NESSIE_KEY` and `data/nessie_ids.json` (run `seed_nessie.py` once if it's missing).
*   Git Bash treats `\` as an escape: use forward slashes in paths there (`.venv/Scripts/python`).

### Verification Before Calling Work Done
1.  `npm run typecheck` passes and `npm run build` succeeds; `.venv/Scripts/python -m pytest` passes in `server/`.
2.  Load the built extension in a browser and exercise the flow with the server running (`http://localhost:3001/health` returns `{"ok":true}`). A clean compile is **not** proof the extension works. Chrome/Chromium 137+ ignore `--load-extension`; for automated tests, launch Chromium with `--remote-debugging-port` and `--enable-unsafe-extension-debugging`, then call CDP `Extensions.loadUnpacked`. On macOS, copy `dist/` out of `~/Desktop` first, or Chromium can't read the path.
3.  Route the checkout URL to a mock page with the checkout button and assert: overlay mounts, Amazon's own click/submit handlers did **not** fire, the page did not navigate, the verdict badge shows, and the first message switches to the server's score. Check both states: on a fresh profile (not activated) clicks **pass through**, and after activating via the popup they're intercepted and the left panel shows the numbers saved in the popup (read back from Nessie).
4.  For popup changes, open `chrome-extension://<id>/src/popup/index.html` at 440×600. Drive it with real keystrokes (`keyboard.press` per digit, not just `fill`), switch tabs, and assert: the save button's enabled state, that each section fits without scrolling, and the stored `chrome.storage.local` value.
5.  Screenshot the overlay at desktop (≈1400px) and narrow (≈700px) widths, plus the popup, and actually look at them. Wait out CSS transitions (~400ms) first, or the screenshot shows half-applied states.

