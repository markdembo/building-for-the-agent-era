# Phase 2 — Parallel Subagent Execution Plan

A plan to build the Phase 2 extension system
(`prompt-phase-2-extension-system.md`) faster by delegating work to **5
subagents**. This is a **pre-build / rehearsal** plan, NOT the ≤5-min live
stage build — the live build stays a single sequential agent because the
prompt's step order is deliberately demoable at every cut point.

> **Source of truth:** every agent must read `AGENTS.md` (repo root) and
> `prompts/prompt-phase-2-extension-system.md` first. The prompt's
> §"Inlined platform reference" is canonical — agents must NOT webfetch the
> Cloudflare / AI SDK / isomorphic-git docs for APIs that are already
> inlined there. All four enforcement layers and frozen surfaces are
> non-negotiable: `globalOutbound: null`, no `bindings` in the loader, the
> `/x/:id` CSP, the classifier gate.

---

## Why parallelize

The 7 steps split into two near-independent halves joined by a frozen API
contract:

- **Backend** (Worker, agent, artifacts, dynamic-worker serving) — the API
  shape is already FROZEN in `AGENTS.md` §4, so the frontend can be built
  against it without waiting on the backend.
- **Frontend** (React + Kumo `/admin` and `/submit`) — consumes only
  `/api/v1/*` JSON; never imports backend code.
- **Prompts** (classifier + generator markdown) — pure text, zero code
  dependency; load-bearing but independently authorable.

Critical-path chain (cannot be collapsed): **Step 1 → Step 2 → Step 4**.
Everything else hangs off that spine and runs alongside it.

---

## Dependency graph

```
            ┌─────────────────────────────────────────────┐
            │  Agent 5: Integration / wrangler / self-test │  (joins at end)
            └─────────────────────────────────────────────┘
                              ▲
   ┌──────────────┬───────────┴───────────┬──────────────┐
   │              │                        │              │
┌──┴───────┐  ┌───┴────────┐         ┌─────┴──────┐   ┌───┴────────┐
│ Agent 1  │  │ Agent 2    │         │ Agent 3    │   │ Agent 4    │
│ Artifacts│  │ Agent loop │         │ Prompts    │   │ Frontend   │
│ + storage│  │ + classifier│        │ (md files) │   │ (admin +   │
│          │  │ + serving  │         │            │   │  submit)   │
└──────────┘  └────────────┘         └────────────┘   └────────────┘
   (backend lib) (backend critical path) (text)        (UI, parallel)
        │              │
        └──────┬───────┘
   Agent 2 depends on Agent 1's artifacts.ts + Agent 3's prompt files
```

- **Agents 1, 3, 4 start immediately** (no cross-deps).
- **Agent 2** depends on Agent 1 (`artifacts.ts`, `memory-fs.ts`) and
  Agent 3 (the two prompt files). It can scaffold the agent loop and tool
  signatures against the documented interfaces while 1 & 3 finish, then
  wire the real imports.
- **Agent 5** integrates, runs typecheck/build once, deploys, and runs the
  Step 7 self-test. It joins after 1–4 land.

> Note: the repo already has stub/partial files for most of these
> (`agent.ts`, `artifacts.ts`, `submit.ts`, `extensions.ts`, `memory-fs.ts`,
> both prompt files, `SubmitPage.tsx`). Each agent's job is to **complete +
> verify** its surface against the prompt, not green-field it.

---

## Agent 1 — Artifacts storage layer

**Owns:** `src/worker/memory-fs.ts`, `src/worker/artifacts.ts`

**Goal:** the `isomorphic-git`-over-Artifacts storage layer that the commit
tool and the serve path both depend on. The `ARTIFACTS` binding only does
repo lifecycle + tokens; all file I/O is `isomorphic-git` on an in-memory FS.

**Deliverables:**
- `MemoryFS` helper — copy verbatim from prompt §"Inlined platform
  reference → Artifacts + isomorphic-git" (the `MemoryFS` block).
- `artifacts.ts` exposing: `createRepo`, `commitFiles`, `readFile`,
  `listCommits`.
  - Token handling: strip `?expires=...`; `onAuth: () => ({ username: "x",
    password: tokenSecret })`.
  - `commitFiles`: init-or-clone(depth 1) → write files → `git.add` →
    `git.commit` (returns SHA) → `git.push` to `main`.
  - `readFile`: shallow clone → `fs.promises.readFile`.
  - `listCommits`: clone → `git.log({ depth: 20 })` → map to
    `{ sha, message, author, timestamp }`.
  - Repo naming `ext-<id>-<slug>`, slug kebab-case ascii ≤40 chars.

**Must NOT:** touch the binding's underlying storage directly; webfetch the
isomorphic-git docs (inlined).

**Verify:** `tsc --noEmit` on the worker; the exported signatures match what
the prompt's §8 tool descriptions expect.

---

## Agent 2 — Generation agent + classifier + serving (critical path)

**Owns:** `src/worker/agent.ts`, `src/worker/submit.ts`,
`src/worker/extensions.ts`, `src/worker/llm.ts` (delete/wrap)

**Goal:** the live pipeline spine — Steps 1, 2, and 4.

**Deliverables:**
- **`submit.ts` (Step 1):** validate body (1–2000 chars) → insert
  `submissions` row (`received`, nanoid 10) → `generateObject` classifier
  on `@cf/zai-org/glm-4.7-flash` with `ClassifierSchema` → branch
  allowed/rejected per prompt §Step 1.4/1.5 → on allow,
  `getAgentByName(env.GENERATION_AGENT, id)` + `agent.startGeneration(job)`.
  Classifier failure → **503 `classifier_unavailable`**, never skip the gate.
- **`agent.ts` (Step 2):** `GenerationAgent extends Agent<Env>`.
  `startGeneration` → `this.schedule(0, "runGeneration", job)` (NO
  `ctx.waitUntil`). `runGeneration` → one `generateText` with `tools` +
  `stopWhen: stepCountIs(8)`. Tools `test_code` (budget 4 via closure
  counter; `env.LOADER.load`, `globalOutbound: null`,
  `AbortSignal.timeout(5000)`) and `commit_and_push_code` (calls Agent 1's
  `artifacts.ts`, then writes the `ready` row). On no-commit → `failed` with
  reason; wrap in try/catch so no row is stranded in `generating`.
- **`extensions.ts` (Step 4):** `/x/:id` — lookup → placeholder for
  non-`ready` (poller for `generating`) → for `ready`,
  `env.LOADER.get(\`${id}@${sha}\`, cb)` reading via Agent 1's
  `readFile`, inject storage-block shim after `<head>`, layer the FROZEN CSP
  + headers. Do not relax the loader posture.

**Depends on:** Agent 1 (`artifacts.ts`), Agent 3 (prompt files imported as
text modules). Scaffold signatures first, wire real imports when ready.

**Must NOT:** hand-roll a `messages`/`tool_calls` loop; use raw `env.AI.run`;
use `ctx.waitUntil`; pass `bindings` to the loader; relax CSP.

**Verify:** `tsc --noEmit`; the three frozen loader call-sites match
`AGENTS.md` §7a verbatim.

---

## Agent 3 — Prompt authoring

**Owns:** `src/prompts/extension-classifier.md`,
`src/prompts/extension-generator.md`

**Goal:** the two load-bearing system prompts. Treated as code.

**Deliverables:**
- **`extension-classifier.md`** — verbatim gatekeeper prompt from
  prompt §Step 1.3 (allow gimmicky/ugly/silly presentation-layer changes;
  block unsafe content + mutation/persistence/exfiltration/injection/abuse;
  strict JSON; `title` 2–5 words; `reason` one sentence;
  `risk_flags` always listed).
- **`extension-generator.md`** — all 8 required sections from prompt
  §Step 2 "The loop": Role, Runtime context, the 4 hard contract rules
  (copied verbatim from `AGENTS.md` §2), API shape with a **real**
  `GET /api/v1/records?limit=2` sample inlined (camelCase fields, marked
  FROZEN), the complete annotated minimal Worker module example, the
  counter-examples ("do not do this") list, the verbatim tool-use loop
  instructions (max 4 `test_code` iterations), and the output-format
  instruction (raw module text, no markdown fences).

**Depends on:** nothing (pure text). To inline the real API sample it may
run `curl .../api/v1/records?limit=2` against a running `npm run dev`, or
abridge from `vinyl-data.json` field names.

**Must NOT:** invent fields not in the FROZEN API shape; weaken any contract
rule.

**Verify:** both files exist, load as Text modules (`wrangler.jsonc` `rules`
+ `text-modules.d.ts`), and the generator example obeys the contract.

---

## Agent 4 — Frontend (admin + submit)

**Owns:** `src/ui/src/pages/AdminPage.tsx` (+ detail view),
`src/ui/src/pages/SubmitPage.tsx`, route wiring in `App.tsx`, any small
admin components

**Goal:** Steps 5 + 6. Builds entirely against the FROZEN `/api/v1/*`
contract — does not wait on the backend.

**Deliverables:**
- **`/admin` (Step 5):** Kumo `Sidebar` + `PageHeader` + `Tabs` (underline):
  Extensions / Submissions / Rejected tables per prompt §Step 5 columns.
  Row click → `/admin/extensions/:id`.
- **Detail `/admin/extensions/:id`:** Tabs Preview
  (`<iframe src="/x/:id" sandbox="allow-scripts">`, ≥600px, Reload button —
  NOT `allow-same-origin`), Code (`CodeHighlighted` from
  `@cloudflare/kumo/code` over `/code`), Commit History (`Table` over
  `/commits`).
- **Real-time:** **polling (option B)** — `/admin` polls
  `GET /api/v1/extensions` (+ `all=1` / `/submissions`) every 3s, toast on
  new `ready`. (SSE only if time remains; default to polling for Wi-Fi.)
- **`/submit` (Step 6):** POST → branch on `rejected` / `generating` /
  `ready` / `failed`; poll `/status` every 2s (90s cap); status banners +
  link to `/x/:id` on ready.

**Coordination:** the API endpoints `/code`, `/commits`, and `?all=1` /
`/submissions` are served by the backend — Agent 4 should mock them locally
(or hit a deployed preview) and Agent 5 confirms the real wiring matches.
**Mirror Phase 1's existing Kumo usage**; if unsure of a component API, use
a plain styled `<div>`/`<table>` rather than spelunking `node_modules`.

**Must NOT:** add `allow-same-origin` to the preview iframe; hardcode colors
(use `kumo-*` tokens).

**Verify:** `npm run build` (UI typecheck + Vite) is clean.

---

## Agent 5 — Integration, config & self-test (the joiner)

**Owns:** `wrangler.jsonc`, `src/worker/index.ts`,
`src/worker/api.ts` (new endpoints), `package.json` deps, `AGENTS.md`
append block

**Goal:** stitch 1–4 together, ensure it compiles/deploys, run Step 7.

**Deliverables:**
- Deps: `npm i agents ai workers-ai-provider zod isomorphic-git`.
- `wrangler.jsonc`: `worker_loaders` LOADER, `durable_objects`
  GENERATION_AGENT + migration `new_sqlite_classes: ["GenerationAgent"]`,
  Text-module `rules` for `src/prompts/*.md`, `LOADER_COMPAT_DATE`.
- `index.ts`: `export { GenerationAgent } from "./agent";` + route the new
  API endpoints.
- `api.ts`: `GET /extensions/:id/code`, `/commits`, `?all=1`,
  `GET /submissions`, `/status` (with `title`).
- **One typecheck/build at the end** (per prompt rule 4), then
  `npm run deploy`.
- **Step 7 self-test:** the full E2E from the prompt — submit "make the
  album covers spin slowly", poll to `ready` (bounded ~30s windows, then
  `wrangler tail` once rather than blind re-polling), verify `/x/:id`, the
  Artifacts repo, `/admin`, and the unsafe-prompt rejection (a HARD gate —
  stop and fix if it isn't rejected).
- Append the Phase 2 summary to `AGENTS.md` at `<!-- PHASE_2_APPEND_BELOW -->`.

**Depends on:** Agents 1–4 complete.

**Must NOT:** declare done on green typecheck alone — Step 7 must pass.

---

## Timeline (rough)

```
t0 ─────────────────────────────────────────────────────────────► done
│ Agent 1 (artifacts) ───────────┐
│ Agent 3 (prompts) ─────────┐   │
│ Agent 4 (frontend) ────────────────────────────┐
│ Agent 2 (spine) ····scaffold····┴──┴ wire+finish ──────┐
│                                                  Agent 5 (integrate+test) ──┘
```

- Sequential single agent: ~15–25 min of agent work.
- 5 parallel agents: ~8–12 min, bounded by **Agent 1/3 → Agent 2 → Agent 5**.

---

## Coordination rules (read before spawning)

1. **Contract is the interface.** The FROZEN `/api/v1/*` shape (`AGENTS.md`
   §4) lets frontend and backend proceed independently. Nobody changes it.
2. **No overlapping file ownership.** The "Owns" list per agent is
   exclusive. `wrangler.jsonc`, `index.ts`, `api.ts`, `AGENTS.md` belong to
   Agent 5 only — others request changes via their final report, they don't
   edit.
3. **Stub-then-wire for Agent 2.** It codes against Agent 1's and Agent 3's
   documented interfaces immediately; swaps to real imports once those land.
4. **Each agent verifies its own surface** (`tsc --noEmit` for worker code,
   `npm run build` for UI) before reporting done. Agent 5 does the single
   integrated build + the E2E self-test.
5. **Frozen safety boundaries are never relaxed by anyone:**
   `globalOutbound: null`, no loader `bindings`, the `/x/:id` CSP + shim,
   the iframe sandbox flags, and the classifier gate.
