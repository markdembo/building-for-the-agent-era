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

Cloudflare stack to use: Workers, Workers Static Assets, Worker Loaders / Dynamic Workers, Artifacts (Git-compatible code storage), Agents SDK, Workers AI or the Anthropic API for LLM calls, D1 or KV for the data layer.

---

## Requirements for Prompt 1 (base app, run before the talk)

### Provisioning via Stripe Projects

- The prompt must instruct the agent to start from zero using the Stripe Projects flow (`stripe projects init`): provision the Cloudflare account/API token through the agentic commerce catalog, **purchase the project domain**, and deploy to that domain. Human-in-the-loop payment approval is expected and fine.
- Domain: instruct the agent to propose 3 short, memorable, available domain options related to vinyl/records before purchasing; the human picks one.

### Architecture (the load-bearing part)

- **Store of record:** vinyl collection data (artist, album, year, genre, cover image URL, notes, optionally "now spinning" flag) in D1 (preferred) or KV. Seeded with ~30 realistic records. Exposed ONLY through a versioned, **read-only JSON API** (`GET /api/v1/records`, `GET /api/v1/records/:id`). No write endpoints exist at all. The API is the single boundary between data and any UI.
- **Default presentation layer:** a clean single-page UI (vanilla JS or lightweight, no build step) that consumes ONLY the public API — it must not have privileged data access. This proves the data/UI split: the default UI is just "extension zero".
- **Extension hook system, built but empty:**
  - A registry concept: each extension = `{ id, title, prompt, status, created_at, artifact_ref }`. Ship the registry table/namespace and a read API (`GET /api/v1/extensions`) returning an empty list.
  - A loader route: `GET /x/:extensionId` — resolves an extension and serves its rendered output. In Phase 1 this returns a styled "no extensions yet" placeholder. The route, resolution logic, and iframe/sandbox plumbing must already exist so Phase 2 only plugs in execution.
  - An extension contract, documented in `AGENTS.md`: an extension is a **single self-contained file** (HTML+CSS+JS inline) that (a) fetches data exclusively from `/api/v1/*`, (b) is fully stateless — no storage of any kind, no cookies, no localStorage, every load is a pure function of (code, API data), (c) uses no npm packages, no imports, no build/transpile step, browser-native ES only, (d) makes no network calls to any origin other than the app's own API.
  - A visible but dormant UI affordance in the default app: an "Extensions" entry point listing registered extensions (empty state: "None yet — soon you'll prompt your own").
- **Bindings pre-created:** Artifacts repo, the Worker Loader binding, the AI/LLM binding, and the D1/KV namespaces must all be created and wired in `wrangler` config during Phase 1 — even the ones only Phase 2 uses. The live demo must never wait on resource provisioning or auth.
- **Submission endpoint stub:** `POST /api/v1/extensions/submit` accepting `{ prompt: string }`, returning `501` with a friendly message in Phase 1. The mobile-friendly submission page (the QR target, `/submit`) is built in Phase 1: a single text box + submit button, shows the 501 gracefully ("the platform doesn't exist yet — come to the talk").

### Quality bar

- Looks good on a projector and on phones. Fast. No build pipeline anywhere.
- Phase 1 prompt must end with a verification checklist the agent self-executes: API returns data, UI renders, `/submit` loads on mobile, `/x/anything` returns the placeholder, all bindings present.

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
2. **Generation agent (Agents SDK):** for allowed submissions, an agent generates the extension as a single self-contained file per the contract in `AGENTS.md`. The generation agent's **system prompt must be written into the codebase as a standalone file** (`src/prompts/extension-generator.md`) and must contain:
   - The extension contract, stated as hard rules.
   - The exact data API shape with a real sample response inlined.
   - **A complete minimal working example extension** (fetch records → render grid), annotated.
   - **Counter-examples / gotchas, explicitly shown as "do not do this":** importing from a CDN or npm; using `localStorage`/cookies/IndexedDB (stateless!); calling external APIs; assuming a build step (JSX, TypeScript); registering service workers; `document.write` after load; infinite render loops on `fetch` errors (always handle the error state); fixed pixel widths that break on phones.
   - Output format instruction: return ONLY the file content, no markdown fences, no commentary.
3. **Storage in Artifacts:** every generated extension (and its originating prompt + classifier JSON) is committed to the Artifacts repo — one directory per extension id. The registry row stores the `artifact_ref`.
4. **Execution via Dynamic Workers:** `/x/:extensionId` loads the code from Artifacts and serves it through the Worker Loader in an isolated, stateless worker — outbound fetch restricted to the app's own API origin, no bindings exposed to extension code, no shared state between loads. Replace the Phase 1 placeholder.
5. **Admin view:** `/admin` — list all submissions with title, prompt, status (pending/generating/ready/rejected/failed), timestamps; click-through to render any ready extension; rejected ones show the classifier's reason. No auth needed (it's a demo), but make it look intentional.
6. **Self-test:** the prompt ends by instructing the agent to submit one extension end-to-end ("make the album covers spin slowly") and verify it renders at its `/x/` URL.

### Statelessness — say it three times

The Phase 2 prompt must state explicitly, in its own section, that extensions are stateless by contract AND by enforcement: the runtime exposes no storage bindings to extension code, and the classifier + generator both treat persistence attempts as violations. This is the demo's safety story; it must hold even against malicious audience prompts.

### Failure honesty

Instruct the agent: if a step fails, fix forward briefly, but never silently skip the classifier or the sandbox restrictions. Cosmetic features are droppable; safety boundaries are not.

---

## Requirements for `AGENTS.md` (written by Phase 1, consumed by Phase 2 and the generator)

- One-screen architecture map: store of record → read-only API → default UI / extensions → loader.
- The extension contract (the four rules above), verbatim.
- Repo conventions: file layout, naming, no build step, deploy command.
- The list of pre-created bindings with their names.
- A "what NOT to touch" list: the data layer and API contract are frozen.

## Global constraints for both prompts

- No frameworks requiring a build step anywhere in the project.
- Everything must be narratable: prefer fewer, clearer files over clever abstractions.
- All LLM calls must request structured JSON where output is consumed programmatically, with schema validation and one retry.
- Mobile-first for `/submit` and `/x/*` (the audience is on phones).
- Assume rehearsal: both prompts will be run multiple times; they must be idempotent or include reset instructions (e.g., a `scripts/reset.sh` that clears extensions but keeps vinyl data).
