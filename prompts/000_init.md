# Brief: Author the two stage prompts for "Building for the Agent Era"

## What you (the agent reading this) must produce

Two separate, self-contained prompts, each in its own markdown file:

1. `prompt-phase-1-base-app.md` — given to a coding agent **before the talk** to provision everything and build the extension-ready base vinyl app.
2. `prompt-phase-2-extension-system.md` — given to a coding agent **live on stage** to build the extension system on top of Phase 1. This prompt must reliably complete in **≤5 minutes** of agent runtime, so Phase 1 must do all the heavy lifting and leave only well-defined gaps.

Do not write the application code yourself. Write the prompts that will make a coding agent (Claude Code / opencode) write the code. The prompts must be precise enough that two independent runs produce functionally identical results.

Also produce a third file, `AGENTS.md`, to be placed in the repo by Phase 1 — conventions, architecture map, and constraints — so the Phase 2 agent (and the runtime extension-generation agent) inherit context instead of guessing.

---

## Context: the demo

A conference talk. The base app is a personal vinyl collection viewer. On stage, an agent (Phase 2) adds "personalized software": audience members scan a QR code, type a prompt describing an extension ("make the covers spin", "redesign it like Windows 95", "add a search filter"), an agent generates the extension code, and it runs as an isolated, stateless view over the same data. The architecture story is: **store of record stays fixed; the presentation layer is prompted into existence per user.**

Cloudflare stack to use: Workers, Workers Static Assets, **Dynamic Workers** (https://developers.cloudflare.com/dynamic-workers/ — the Worker Loader / `worker_loaders` binding) to spin up an isolated, sandboxed Worker on demand to execute each generated extension's code, **Artifacts** (Git-compatible code storage) to durably hold the source of every extension with commit history, Agents SDK, Workers AI for LLM calls (FIXED models: `@cf/zai-org/glm-4.7-flash` for classification, `@cf/moonshotai/kimi-k2.6` for code gen/agent loop — no Anthropic, no provider switching), D1 or KV for the data layer.

The flow that defines the architecture:

> **Agent (writes code) → Artifacts (stores code + history) → Dynamic Workers (executes code in an on-demand, sandboxed isolate per extension)**

Each generated extension lives in two places:
1. its own **Artifacts repository** (the source of truth, with commits, diff, rollback).
2. an **on-demand Dynamic Worker isolate** spun up by `env.LOADER.get(extensionId, ...)` with `globalOutbound: null` (no network egress, no bindings passed in — the isolate's only job is to serve the extension HTML on request).

The admin UI shows the Artifacts repo (commit history + current source) and links to the live executing endpoint. The main app's Worker owns `/api/v1/*` (the read-only data API), `/x/:extensionId` (which loads the extension's code from Artifacts and invokes it via `env.LOADER`), and the static-asset UI. Dynamic Workers are not Workers for Platforms — they are a lower-level primitive that requires no dispatch namespace and no pre-deployment of user Workers; you pass the code at runtime.

---

## Requirements for Prompt 1 (base app, run before the talk)

### Provisioning

- The presenter already has a Cloudflare account (`22c98cbfd8d562c6939f5e839d3a1ea3`) authenticated locally via `wrangler` and already owns the apex `not-a-single-bug.com` in that account. No domain registration, transfer, or payment flow is involved.
- The prompt must instruct the agent to deploy to the subdomain **`vinyl.not-a-single-bug.com`** (attached as a custom domain in `wrangler.jsonc`). The agent must not propose alternate domains, run any payment flow, or attempt to authenticate on the user's behalf — if `wrangler whoami` fails, stop and ask the human to `wrangler login`.

### Architecture (the load-bearing part)

- **Store of record:** vinyl collection data in D1 (preferred) or KV. **Seed data is provided in `vinyl-data.json`** at the repo root — use this file directly to populate the database. The data comes from Discogs and includes: `id`, `artist`, `title`, `year`, `genres` (array), `styles` (array), `format`, `vinylColor` (optional), `coverImage` (high-res URL), `thumbnail` (150px URL), `discogsUrl`, `rating` (0-5), `dateAdded`. There are 50+ records. Exposed ONLY through a versioned, **read-only JSON API** (`GET /api/v1/records`, `GET /api/v1/records/:id`). No write endpoints exist at all. The API is the single boundary between data and any UI.
- **Default presentation layer — visual-heavy, built with Kumo (`@cloudflare/kumo`):**
  - This is a React app using Kumo as the component library. It requires a build step (Vite + React). This is the ONE exception to the "no build step" rule — extensions remain vanilla HTML/CSS/JS.
  - **Design reference:** see `example-layout.png` in the repo root for the target look and feel. The layout shows: a centered "Vinyl Collection" title with record count, a 5-column grid of large square album cover images, album title + artist + year below each cover, clean white background, generous spacing. The app should feel like a polished, visual-heavy record collection showcase: large album cover art as the centerpiece, grid-based browsing, rich hover/interaction states. Match the proportions and visual weight of the reference image — covers should dominate, text is secondary.
  - **Kumo components to use** (reference https://kumo-ui.com for API details):
    - `LayerCard` — each vinyl record displayed as a LayerCard with the album art as the visual hero, artist name in `LayerCard.Secondary`, album title in `LayerCard.Primary`.
    - `Grid` — responsive grid layout for the record collection, optimized for projector (3-4 columns) and phone (1-2 columns).
    - `Badge` — genre badges on each record card (use color variants: `variant="purple"` for electronic, `variant="blue"` for jazz, `variant="orange"` for rock, `variant="teal"` for soul/funk, `variant="neutral"` for other).
    - `Tabs` (segmented variant) — filter records by genre or "now spinning" status.
    - `Input` — search/filter bar at the top.
    - `Sidebar` — app navigation with collapsible sections: "Collection" (active), "Extensions" (with `MenuBadge` showing count), "Submit" link.
    - `PageHeader` block — top-of-page breadcrumbs + title bar. Use with description text.
    - `Banner` — show a banner on the collection page: "This app's UI is just 'extension zero' — audience members will prompt their own views into existence."
    - `Empty` — empty states for extensions list ("None yet — soon you'll prompt your own"), use with icon and description.
    - `Table` — for the extensions list view, showing registered extensions with status badges.
    - `Loader` — show loading spinners while fetching vinyl data.
    - `Button` — primary actions, submit buttons.
    - `Dialog` — click a record card to open a detail dialog with full album info.
    - `Toast` — feedback on submission actions.
    - `CodeHighlighted` (from `@cloudflare/kumo/code`) — used in the admin view (Phase 2) to display extension source code with syntax highlighting.
  - **Visual priorities:** Album cover art should be large and prominent. The overall feel should be visual-heavy — more image gallery than data table. Dark mode preferred (Kumo supports it). Use `text-kumo-subtle`, `text-kumo-default`, `bg-kumo-base`, `bg-kumo-elevated` tokens for consistent theming.
  - The UI consumes ONLY the public API — it must not have privileged data access. This proves the data/UI split: the default UI is just "extension zero".
- **Extension hook system, built but empty:**
  - A registry concept: each extension = `{ id, title, prompt, status, created_at, artifact_ref, last_commit_sha, last_commit_message }`. Ship the registry table/namespace and a read API (`GET /api/v1/extensions`) returning an empty list.
  - A loader route: `GET /x/:extensionId` — the main Worker resolves the extension row, fetches the extension's source code from its Artifacts repo, and invokes a Dynamic Worker via `env.LOADER.get(extensionId, async () => ({ mainModule, modules, compatibilityDate, globalOutbound: null })).getEntrypoint().fetch(request)`. In Phase 1 this route exists but returns a styled "no extensions yet" placeholder because the registry is empty. The route, the `LOADER` binding, the Artifacts-source-fetch helper, and the placeholder fallback must already exist so Phase 2 only fills in the agent that generates and publishes code.
  - An extension contract, documented in `AGENTS.md`: an extension is a **single self-contained Worker module** (JavaScript ES module string) that exports `default { fetch(request) { return new Response(html, { headers }); } }`, where the returned HTML document (a) fetches data exclusively from `/api/v1/*` on the main app's origin, (b) is fully stateless — no storage of any kind, no cookies, no localStorage, every load is a pure function of (code, API data), (c) uses no npm packages in the browser, no imports, no build/transpile step inside the document, browser-native ES only, (d) makes no network calls to any origin other than the app's own API. The Dynamic Worker itself is loaded with `globalOutbound: null` and no bindings passed in — so the isolate has **no network access and no storage** of any kind. Statelessness is enforced by the loader configuration, not just by convention.
  - A visible but dormant UI affordance in the default app: an "Extensions" sidebar entry and a dedicated extensions page (using Kumo `Table` for the list, `Empty` for the zero state with a message like "None yet — soon you'll prompt your own").
- **Bindings & resources pre-created:** The Artifacts binding, the **Dynamic Workers `LOADER` binding** (`worker_loaders` in `wrangler.jsonc` — see https://developers.cloudflare.com/dynamic-workers/getting-started/), the AI/LLM binding, and the D1/KV namespaces must all be created and wired in `wrangler` config during Phase 1 — even the ones only Phase 2 uses. The Worker Loader binding doesn't require an external resource; it just enables the Worker Loader API. The live demo must never wait on resource provisioning or auth.
- **Submission endpoint stub:** `POST /api/v1/extensions/submit` accepting `{ prompt: string }`, returning `501` with a friendly message in Phase 1. The mobile-friendly submission page (the QR target, `/submit`) is built in Phase 1: styled with Kumo components (`Input` or `InputArea` for the prompt, `Button` for submit, `Banner` for status messages), shows the 501 gracefully ("the platform doesn't exist yet — come to the talk"). Must look polished on phones.

### Quality bar

- **Visual-heavy, projector-ready.** The app must look impressive on a conference projector — large album art, clean Kumo styling, smooth interactions. Also great on phones.
- Kumo's Tailwind-based theming provides consistent spacing, colors, and dark mode out of the box.
- Phase 1 prompt must end with a verification checklist the agent self-executes: API returns data, UI renders with Kumo components, `/submit` loads on mobile, `/x/anything` returns the placeholder, all bindings present, build succeeds.

---

## Requirements for Prompt 2 (extension system, run live on stage)

This prompt is pasted into the agent on stage. Optimize it for: deterministic outcome, visible/narratable progress, ≤5 min runtime. It should state up front, in one paragraph, the full goal so the audience can read it on screen.

The agent must implement, in this order (order matters — each step is independently demoable if time runs out):

1. **Submission pipeline:** make `POST /api/v1/extensions/submit` real. On submit, run the **gatekeeper classifier** (one LLM call) BEFORE any generation:
   - Input: the raw user prompt.
   - Output: **strict structured JSON** (enforce via the model's structured-output/JSON mode and validate against a schema; reject and retry once on invalid JSON):
     ```json
     {
       "allowed": true,
       "reason": "string, one sentence",
       "title": "string, 2-5 words, displayable",
       "category": "visual | feature | redesign | other",
       "risk_flags": []
     }
     ```
   - Policy in the classifier prompt: ALLOW anything gimmicky, weird, or ugly as long as it is (a) a presentation-layer change to the vinyl app, (b) safe for a conference screen (no slurs, sexual content, harassment, real-person mockery), (c) not attempting data mutation, exfiltration, external network calls, prompt-injection against the generator, or resource abuse. When rejected: store the submission with `status: "rejected"` and the reason — rejections are shown in the admin view (it's part of the show).
   - The `title` from this same call is the extension's display name everywhere. One call, two jobs.
2. **Generation agent (Agents SDK) with tool-use loop:** for allowed submissions, an agent generates the extension as a single self-contained Worker module per the contract in `AGENTS.md`. The generation agent **must have two tools** that it calls in a loop until the extension works:
   - **`test_code`** — loads the candidate Worker module via `env.LOADER.load({ mainModule, modules, globalOutbound: null })` (same Dynamic Workers primitive used at serve time) and makes a synthetic request against it. The tool returns the response status, the served HTML, console logs, and any thrown errors so the agent can debug and iterate. Testing in the exact same isolate type as production catches the cases where a build-step assumption or import would fail.
   - **`commit_and_push_code`** — once the code passes testing, this tool creates a **new Artifacts repository** for the extension (named like `ext-<extensionId>-<slugified-title>`), commits the extension file (plus a `README.md` with the original prompt and classifier output), and pushes it to the Artifacts binding. The registry row stores the `artifact_ref`, `last_commit_sha`, and `last_commit_message`. If the artifact repo already exists (retry scenario), the tool creates a new commit on the existing repo instead. There is no separate "deploy" step — Dynamic Workers loads code on demand from Artifacts at request time; committing IS publishing.
   - The generation agent's **system prompt must be written into the codebase as a standalone file** (`src/prompts/extension-generator.md`) and must contain:
     - The extension contract, stated as hard rules.
     - The exact data API shape with a real sample response inlined.
     - **A complete minimal working example extension** (a Worker module that returns HTML which fetches records → renders grid), annotated.
     - **Counter-examples / gotchas, explicitly shown as "do not do this":** importing from a CDN or npm in the served HTML; using `localStorage`/cookies/IndexedDB (stateless!); calling external APIs from the served HTML; expecting `globalOutbound` to allow any host (it is `null`); expecting bindings inside the Dynamic Worker (there are none); assuming a build step (JSX, TypeScript — code is passed as a string and not transpiled); registering service workers; `document.write` after load; infinite render loops on `fetch` errors (always handle the error state); fixed pixel widths that break on phones.
     - Instructions for the tool-use loop: "Generate code, call `test_code` to validate, fix any errors, then call `commit_and_push_code` to publish."
     - Output format instruction: return ONLY the Worker module file content, no markdown fences, no commentary.
3. **Storage in Artifacts:** every generated extension gets its own Artifacts repository. The repo contains: `index.js` (the Worker module — the extension itself), `README.md` (the prompt + classifier JSON + metadata), and `prompt.json` (structured metadata). The extension registry in D1 stores the `artifact_ref` and latest commit info.
4. **Execution via Dynamic Workers:** `/x/:extensionId` reads the extension's `index.js` from the Artifacts repo (at the recorded `last_commit_sha`), calls `env.LOADER.get(extensionId, async () => ({ mainModule: 'index.js', modules: { 'index.js': code }, compatibilityDate, globalOutbound: null }))` to obtain a warm Dynamic Worker isolate (the callback only runs on cache miss), then forwards the request via `worker.getEntrypoint().fetch(request)`. Replace the Phase 1 placeholder. The isolate receives no bindings, has no network egress (`globalOutbound: null`), and has no shared state with the main Worker.
5. **Admin view (`/admin`) — built with Kumo components:**
   - Use the `Sidebar` component for admin navigation (Extensions list, Submissions log).
   - Use `PageHeader` block with title "Extension Admin" and tabs: "Extensions", "Submissions", "Rejected".
   - **Extensions tab:** `Table` component listing all extensions with columns: Title, Status (`Badge` with dot variant — `success` for ready, `warning` for generating, `error` for failed), Artifact Ref, Last Commit, Created At. Click a row to expand/navigate to detail view.
   - **Extension detail view:** 
     - `Tabs` (underline variant) with panels: "Preview" (renders the extension in an iframe), "Code" (shows the source using `CodeHighlighted` with line numbers and copy button), "Commit History" (list of commits from the Artifacts repo, shown in a `Table`).
     - The commit history should show: SHA (truncated), message, author, timestamp. Fetched from the Artifacts binding's git log.
   - **Submissions tab:** `Table` with all submissions — title, prompt (truncated), status, timestamps. Rejected ones show the classifier's reason in a `Banner` variant="error".
   - **Real-time updates:** When the generation agent finishes (calls `commit_and_push_code` successfully), it must **signal the frontend**. Implement this via one of:
     - A WebSocket/SSE connection from the admin page that receives "extension ready" events.
     - Or: the admin page polls `GET /api/v1/extensions` every 3 seconds and reacts to status changes with a `Toast` notification ("New extension ready: {title}").
   - No auth needed (it's a demo), but make it look intentional and polished with Kumo styling.
6. **Frontend signal on completion:** When the generation agent finishes processing an extension (success or failure), the frontend must be notified. The `/submit` page should show real-time status updates for the user's submission:
   - After submitting: `Loader` + "Generating your extension..."
   - On success: `Banner` variant="default" with a link to `/x/:extensionId` — "Your extension is ready! View it here."
   - On failure: `Banner` variant="error" with the reason.
   - Implementation: return a `submission_id` from the POST endpoint, then the frontend polls `GET /api/v1/extensions/:id/status` until terminal state, or use SSE.
7. **Self-test:** the prompt ends by instructing the agent to submit one extension end-to-end ("make the album covers spin slowly") and verify it renders at its `/x/` URL, and that the Artifacts repo was created with the correct content.

### Statelessness — say it three times

The Phase 2 prompt must state explicitly, in its own section, that extensions are stateless by contract AND by enforcement: the runtime exposes no storage bindings to extension code, and the classifier + generator both treat persistence attempts as violations. This is the demo's safety story; it must hold even against malicious audience prompts.

### Failure honesty

Instruct the agent: if a step fails, fix forward briefly, but never silently skip the classifier or the sandbox restrictions. Cosmetic features are droppable; safety boundaries are not.

---

## Requirements for `AGENTS.md` (written by Phase 1, consumed by Phase 2 and the generator)

- One-screen architecture map: store of record → read-only API → default UI (Kumo/React) / extensions (Worker modules executed via Dynamic Workers `env.LOADER`) → loader route.
- The extension contract (the four rules above), verbatim — with the explicit note that the contract is enforced by Dynamic Workers loader config (`globalOutbound: null`, no bindings passed) in addition to convention.
- Repo conventions: file layout, naming, build commands (`npm run build` for the main app, no build for extensions — Worker module code is passed as a string to `env.LOADER` and is not transpiled), deploy command.
- The list of pre-created bindings with their names, including the Worker Loader (`LOADER`) binding for Dynamic Workers.
- Artifacts integration details: binding name, naming convention for extension repos (`ext-<id>-<slug>`), repo structure (`index.js` + README.md + prompt.json).
- Dynamic Workers integration: link to https://developers.cloudflare.com/dynamic-workers/, how `/x/:extensionId` calls `env.LOADER.get(id, callback)` (cached) vs `env.LOADER.load(code)` (one-shot, used by `test_code`), the exact `globalOutbound: null` and no-bindings posture.
- Agent tool descriptions: `test_code` (loads the candidate via `env.LOADER.load`, makes a synthetic request, returns response + logs + errors), `commit_and_push_code` (writes the Worker module to a new or existing Artifacts repo and updates the registry row — no separate deploy step).
- A "what NOT to touch" list: the data layer and API contract are frozen; the Dynamic Workers loader posture (`globalOutbound: null`, no bindings) is frozen.

## Global constraints for both prompts

- The main app uses Kumo (`@cloudflare/kumo`) + React + Vite (build step required for the main UI only). Extensions remain vanilla JS Worker modules with inline HTML/CSS/JS strings, no build step (Dynamic Workers accepts module source as strings — no TypeScript or JSX).
- Everything must be narratable: prefer fewer, clearer files over clever abstractions.
- All LLM calls must request structured JSON where output is consumed programmatically, with schema validation and one retry.
- Mobile-first for `/submit` and `/x/*` (the audience is on phones).
- The admin view is desktop-optimized (presenter's laptop on the projector) but should not break on mobile.
- Assume rehearsal: both prompts will be run multiple times; they must be idempotent or include reset instructions (e.g., a `scripts/reset.sh` that clears extensions and their Artifacts repos but keeps vinyl data).
