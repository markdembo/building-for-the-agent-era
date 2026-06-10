# AGENTS.md

This file is the canonical, Phase 1-authored brief for Phase 2 and for the
runtime extension-generator agent. Read it before touching anything.

---

## 1. Architecture map

```
                      ┌──────────────────────────┐
                      │   D1: records (frozen)   │  ← seeded from vinyl-data.json
                      └─────────────┬────────────┘
                                    │  read-only
                          ┌─────────▼──────────┐
                          │  /api/v1/* (JSON)  │  ← single boundary; FROZEN shape
                          └────┬─────────┬─────┘
                               │         │
        ┌──────────────────────▼─┐     ┌─▼──────────────────────────────────┐
        │ Default UI             │     │ Extensions                         │
        │ React + Vite + Kumo    │     │ ES Worker modules stored in        │
        │ served via Static      │     │ Artifacts; executed on demand via  │
        │ Assets                 │     │ env.LOADER (Dynamic Workers)       │
        │                        │     │ at /x/:extensionId                 │
        └────────────────────────┘     └────────────────────────────────────┘
                              served by the same Worker
```

Pipeline:

> **Agent (writes code) → Artifacts (stores code + history) → Dynamic Workers
> (executes code in an on-demand, sandboxed isolate per extension)**

The default UI is "extension zero": it consumes the same public API any
extension does. The data layer never knows about the UI. Each extension
runs in its own Dynamic Worker isolate with `globalOutbound: null` and
no bindings.

Dynamic Workers reference:
https://developers.cloudflare.com/dynamic-workers/

---

## 2. The extension contract (FROZEN)

An extension is **a single self-contained Worker module** — one ES module
string with a `default { fetch(request) }` handler that returns a `Response`
containing one HTML document. The module is loaded by
`env.LOADER.load({ mainModule: "index.js", modules: { "index.js": code }, globalOutbound: null })` —
no transpilation, no bundler, no bindings passed in.

Hard rules:

1. **Data only via `/api/v1/*`** on the same origin (called from the served
   HTML, never from inside the Worker module). No other fetch destinations.
2. **Fully stateless.** No `localStorage`, `sessionStorage`, `indexedDB`,
   cookies, `caches`, `navigator.serviceWorker`, `BroadcastChannel`, or any
   other persistence — in either the Worker handler or the served HTML.
   Every load is a pure function of (code, API data).
3. **No npm / no imports / no build step.** The Worker module is plain ES —
   no TypeScript, no JSX, no bare-specifier imports (Dynamic Workers does
   not transpile). The served HTML is browser-native ES only — no CDN
   script tags.
4. **No external network.** Same-origin API calls only. The Worker has none
   (`globalOutbound: null`). Images returned by the API may have third-party
   URLs — those are allowed because the API returns them.

Enforced at runtime in four layers (defense in depth):

1. **Dynamic Workers loader posture** — `globalOutbound: null` + no bindings
   = primary safety boundary.
2. **CSP** on the `/x/:id` response (see `src/worker/extensions.ts`).
3. Phase 2 should add an inline storage-blocking shim at the top of the
   served HTML and an iframe sandbox in the admin preview.

---

## 3. Frozen surfaces — do NOT touch

- `/api/v1/records*` response shape (section 4).
- The D1 `records` table schema.
- The extension contract above.
- The `/x/:extensionId` sandbox CSP (`EXTENSION_HEADERS` in
  `src/worker/extensions.ts`).
- The Dynamic Workers loader posture: `globalOutbound: null`, no `bindings`
  passed in. Never relax either.
- `vinyl-data.json`.

Everything else is fair game.

---

## 4. API shape (FROZEN)

```ts
type Record = {
  id: number;
  artist: string;
  title: string;
  year: number | null;
  genres: string[];
  styles: string[];
  format: string | null;
  vinylColor: string | null;
  coverImage: string;
  thumbnail: string;
  discogsUrl: string | null;
  rating: number | null;
  dateAdded: string; // ISO
};

type Extension = {
  id: string;
  title: string;
  prompt: string;
  status: "pending" | "generating" | "ready" | "failed" | "rejected";
  category: "visual" | "feature" | "redesign" | "other" | null;
  reason: string | null;
  artifact_ref: string | null;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  created_at: string;
  updated_at: string;
};
```

Endpoints:

- `GET  /api/v1/records` → `{ records: Record[] }`
  optional query: `?genre=Rock&style=Indie+Rock&q=substring`
- `GET  /api/v1/records/:id` → `{ record: Record }` or 404
- `GET  /api/v1/extensions` → `{ extensions: Extension[] }`
- `GET  /api/v1/extensions/:id` → `{ extension: Extension }` or 404
- `GET  /api/v1/extensions/:id/status` → `{ id, status, reason?, extension_id? }`
- `GET  /api/v1/extensions/:id/code` → `{ html, sha }` (Phase 2)
- `GET  /api/v1/extensions/:id/commits` → `{ commits: [...] }` (Phase 2)
- `POST /api/v1/extensions/submit`
  - Phase 1: returns HTTP 501 with `{ error: "not_implemented", message }`
  - Phase 2: returns `{ submission_id, extension_id?, status, title?, reason? }`

`/x/:extensionId` is a Worker route, not an API endpoint. It serves HTML.

---

## 5. Repo conventions

File layout:

```
/                          repo root
  wrangler.jsonc           Worker, Static Assets, D1, AI, Artifacts, LOADER
  package.json             root workspace: scripts for dev/build/deploy/seed/reset
  vinyl-data.json          seed data (do not modify)
  example-layout.png       visual reference
  AGENTS.md                this file
  README.md
  tsconfig.json
  /src
    /worker
      index.ts             entry: routes /api/v1/*, /x/:id, /submit
      api.ts               read-only API handlers
      extensions.ts        loader route + resolveExtension + EXTENSION_HEADERS
      submit.ts            POST /api/v1/extensions/submit stub (501 in Phase 1)
      db.ts                D1 helpers
      artifacts.ts         thin abstraction over the ARTIFACTS binding
      llm.ts               callLLMJson stub — Phase 2 fills in
      types.ts             shared DTOs + WorkerLoader types
    /prompts/.gitkeep      Phase 2 writes extension-generator.md here
    /ui                    React + Vite + Kumo app (extension zero)
      …
  /scripts
    seed.ts                vinyl-data.json → D1 (INSERT OR REPLACE)
    reset.sh               clear extensions + submissions in D1
  /migrations
    0001_init.sql          records + extensions + submissions
```

Choices:

- TypeScript strict everywhere except inside extensions (which are plain
  HTML/CSS/JS by contract).
- No default exports except React page components.
- Tailwind v4 via the Kumo preset; never hardcode colors — use
  `text-kumo-*`, `bg-kumo-*` tokens.
- Worker entry is `src/worker/index.ts`. One router; small handler files.
- Client-side routing for the UI; server-side routing for `/api/v1/*` and
  `/x/:id`.
- **Monorepo packaging:** root `package.json` with `src/ui` as a workspace.
  Worker code lives at the repo root and is built directly by `wrangler`;
  the UI is built by `vite` into `src/ui/dist`, which Static Assets serves.

### Build & deploy commands

| command                 | what it does                                           |
| ----------------------- | ------------------------------------------------------ |
| `npm run dev`           | Vite + `wrangler dev` in parallel                      |
| `npm run build`         | builds the UI (TypeScript + Vite)                      |
| `npm run deploy`        | `npm run build && wrangler deploy`                     |
| `npm run seed`          | runs `scripts/seed.ts` against remote D1 (idempotent)  |
| `npm run migrate`       | applies migrations to remote D1                        |
| `bash scripts/reset.sh` | clears extensions + submissions; keeps vinyl           |

Extensions have no build step.

---

## 6. Bindings (in `wrangler.jsonc`)

| name        | type                  | purpose                                                                                            |
| ----------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `ASSETS`    | Workers Static Assets | serves the built React UI (`src/ui/dist`)                                                          |
| `DB`        | D1                    | records, extensions, submissions (db_name `vinyl-app-db`, id `888acc88-a896-402b-a510-b76abdda2496`) |
| `AI`        | Workers AI            | LLM calls. **Fixed models, no provider switching:** classifier = `@cf/zai-org/glm-4.7-flash`; generator/agent = `@cf/moonshotai/kimi-k2.6`. Reached via the **AI SDK** (`ai` + `workers-ai-provider` `createWorkersAI({ binding: env.AI })`), not raw `env.AI.run`. No Anthropic, no OpenAI-compatible endpoint. |
| `ARTIFACTS` | Cloudflare Artifacts  | one Git repo per generated extension; namespace `vinyl-app`                                        |
| `LOADER`    | Dynamic Workers (`worker_loaders`) | executes each extension on demand in an isolated, sandboxed Worker                    |
| `GENERATION_AGENT` | Durable Object (Agents SDK `Agent`, class `GenerationAgent`) | runs the generation agent loop in its own alarm lifecycle (`this.schedule`), **never `ctx.waitUntil`** |

Env vars:

- `APP_ORIGIN` = `https://vinyl.not-a-single-bug.com` — same-origin checks
  and CSP.
- `LOADER_COMPAT_DATE` = `2026-06-10` — passed to every `env.LOADER.load`
  / `env.LOADER.get` so test-time and serve-time isolates behave
  identically.

`wrangler.jsonc` shapes:

```jsonc
"worker_loaders": [{ "binding": "LOADER" }],
"artifacts": [{ "binding": "ARTIFACTS", "namespace": "vinyl-app" }],
"ai": { "binding": "AI" },
"durable_objects": { "bindings": [{ "name": "GENERATION_AGENT", "class_name": "GenerationAgent" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["GenerationAgent"] }],
"d1_databases": [
  { "binding": "DB", "database_name": "vinyl-app-db", "database_id": "888acc88-a896-402b-a510-b76abdda2496" }
]
```

Phase 2 deps: `npm i agents ai workers-ai-provider zod isomorphic-git`.
Export the agent from the Worker entry: `export { GenerationAgent } from "./agent";`

---

## 7. Artifacts integration

- Binding: `ARTIFACTS`, namespace `vinyl-app`.
- Docs: https://developers.cloudflare.com/artifacts/
- Repo naming: `ext-<extensionId>-<slugified-title>` (kebab-case ascii,
  max 40 chars).
- Repo structure:
  - `index.js` — the extension itself (ES module string with default
    `fetch` handler).
  - `README.md` — original prompt + classifier output + metadata.
  - `prompt.json` — `{ extension_id, title, prompt, classifier:{ allowed, reason, category, risk_flags }, created_at }`.
- Commit messages: `feat: <title>` on first commit; `iterate: <title> (attempt N)`
  on subsequent iterations.
- Registry row stores `artifact_ref`, `last_commit_sha`,
  `last_commit_message`.
- **No separate deploy step.** `env.LOADER.get(cacheKey, callback)` at
  `/x/:id` reads the latest source from Artifacts on cache miss, so a fresh
  commit is live the moment it lands. Cache key:
  `${extensionId}@${last_commit_sha}` to deterministically invalidate per
  commit.
- Phase 1 created the binding but does not call it. `src/worker/artifacts.ts`
  exposes `createRepo`, `commitFiles`, `listCommits`, `readFile` —
  `createRepo` is wired to `env.ARTIFACTS.create(name)`; the rest are stubs
  Phase 2 must implement. **The `ARTIFACTS` binding cannot read/write
  files — only repo lifecycle + tokens.** Implement `commitFiles` /
  `readFile` / `listCommits` with `isomorphic-git` (`npm i isomorphic-git`)
  over the repo `remote` + token, using an in-memory `MemoryFS`. Strip the
  `?expires=...` suffix from the token and pass the secret as the git
  Basic-auth password. Full inlined code in the Phase 2 prompt
  §"Inlined platform reference"; reference:
  https://developers.cloudflare.com/artifacts/examples/isomorphic-git/

---

## 7a. Dynamic Workers integration

- Binding: `LOADER` (`worker_loaders` in `wrangler.jsonc`).
- Docs: https://developers.cloudflare.com/dynamic-workers/getting-started/
- **Serve path** (cached, used by `/x/:extensionId` — Phase 2 fills in):
  ```ts
  const worker = env.LOADER.get(`${ext.id}@${ext.last_commit_sha}`, async () => {
    const code = await artifacts.readFile(ext.artifact_ref!, ext.last_commit_sha!, "index.js");
    return {
      compatibilityDate: env.LOADER_COMPAT_DATE,
      mainModule: "index.js",
      modules: { "index.js": code },
      globalOutbound: null,
    };
  });
  const inner = await worker.getEntrypoint().fetch(request);
  return layerHeaders(inner); // applies CSP + other defense-in-depth headers
  ```
- **Test path** (one-shot, used by `test_code`):
  ```ts
  const worker = env.LOADER.load({
    compatibilityDate: env.LOADER_COMPAT_DATE,
    mainModule: "index.js",
    modules: { "index.js": candidateCode },
    globalOutbound: null,
  });
  const res = await worker.getEntrypoint().fetch(
    new Request("https://test.local/"),
    { signal: AbortSignal.timeout(5000) }
  );
  ```
- **Never** pass a `bindings` field. **Never** set `globalOutbound` to
  anything other than `null`. These are frozen.

Phase 1 smoke-tested this binding successfully with the code from
verification step 11 (response body `ok-from-dynamic-worker`). Phase 2 can
rely on it being wired.

---

## 8. Agent tools (Phase 2)

**Execution model (frozen):** the loop runs in the Agents SDK
`GenerationAgent` Durable Object, kicked off via
`getAgentByName(env.GENERATION_AGENT, id)` + `this.schedule(0,
"runGeneration", job)`. The loop is a single AI SDK `generateText({ model:
workersai("@cf/moonshotai/kimi-k2.6"), tools, stopWhen: stepCountIs(8) })`
call — the SDK drives the tool-use loop. **No `ctx.waitUntil`** (cancelled
after the response) and **no hand-rolled `messages`/`tool_calls` loop**.
The two tools are AI SDK `tool({ inputSchema: z…, execute })` definitions;
the classifier is one `generateObject({ schema })` call.

### `test_code(code: string)`

Loads a candidate Worker module via `env.LOADER.load(...)` and makes a
synthetic request.

```ts
test_code(code: string): Promise<{
  ok: boolean;
  status: number;        // HTTP status from the test fetch
  html: string;          // response body (truncated to ~64KB)
  logs: string[];        // console.* captured from the isolate
  errors: string[];      // syntax / thrown / unhandled rejection / policy violation
}>;
```

Enforces by virtue of the loader posture:

- `globalOutbound: null` blocks all outbound network from the isolate.
- No bindings are passed in → no D1, no AI, no Artifacts, no KV.
- 5-second time budget on the test fetch via `AbortSignal.timeout(5000)`.
  Timeout → `ok: false`, `errors: ["timeout"]`.
- `ok: true` requires `status === 200`, a non-empty HTML body, and no
  captured errors.

`test_code` does not validate the browser-side behavior of the served HTML
(whether the `<script>` inside actually fetches `/api/v1/records`). That is
the responsibility of the Step 7 self-test which loads `/x/:id` end-to-end.

### `commit_and_push_code(input)`

```ts
commit_and_push_code(input: {
  extensionId: string;
  title: string;
  code: string;         // the Worker module source
  readme: string;
  promptJson: object;
}): Promise<{
  artifact_ref: string;
  commit_sha: string;
  commit_message: string;
}>;
```

Creates or reuses the Artifacts repo `ext-<id>-<slug>` (via the `ARTIFACTS`
binding), then commits the three files (`index.js`, `README.md`,
`prompt.json`) and pushes them with `isomorphic-git` over the repo `remote`
+ a write token (the binding itself can't write files). On retry, clones
the existing repo first so the new commit keeps prior history. There is no
separate deploy step — `env.LOADER.get` pulls the latest source from
Artifacts on cache miss.

### Classifier (replaces the `callLLMJson` stub)

The classifier is one AI SDK `generateObject({ model:
workersai("@cf/zai-org/glm-4.7-flash"), schema })` call — the SDK validates
the output against the zod schema, so the `callLLMJson` stub in
`src/worker/llm.ts` is superseded (delete it or have it wrap
`generateObject`). No Workers AI raw `env.AI.run`, no Anthropic, no
provider switching.

---

## 9. Deployment

- Production hostname: `vinyl.not-a-single-bug.com` (subdomain of the
  already-owned apex `not-a-single-bug.com`). Custom domain is attached
  via `wrangler.jsonc` `routes`.
- Workers.dev fallback: `https://vinyl-app.not-a-single-bug.workers.dev`.
- Cloudflare account id: `22c98cbfd8d562c6939f5e839d3a1ea3` (existing
  account; no registration or payment flow needed). Wired into
  `wrangler.jsonc` as `account_id`.
- D1 database id: `888acc88-a896-402b-a510-b76abdda2496` (`vinyl-app-db`).
- Roll back: `wrangler rollback` to the prior deployment.
- Reset extensions: `bash scripts/reset.sh`.

---

## 10. What NOT to touch

- The D1 `records` table and `vinyl-data.json`.
- The `/api/v1/records*` response shape.
- The extension contract.
- The `/x/:extensionId` CSP (`EXTENSION_HEADERS`) and the layering helper
  `layerHeaders`.
- The Dynamic Workers loader posture: `globalOutbound: null`, no
  `bindings` passed in.
- The classifier and generator prompts after the talk starts — edit before,
  freeze on stage.

---

## 11. Fallbacks taken during Phase 1

| Brief named                  | Available? | What we used                                                                 |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------- |
| `@cloudflare/kumo`           | yes        | `@cloudflare/kumo` v2.5.1 (real package — no substitution needed)            |
| `ARTIFACTS` binding          | yes        | Real Cloudflare Artifacts binding (closed beta — account has access). `src/worker/artifacts.ts` wraps it with a small interface. `createRepo` is wired; `commitFiles` / `readFile` / `listCommits` are stubs Phase 2 implements via `isomorphic-git` (the binding can't read/write files). |
| Workers AI binding           | yes        | `env.AI` binding declared; Phase 1 doesn't call it. **Fixed models:** classifier `@cf/zai-org/glm-4.7-flash` + generator `@cf/moonshotai/kimi-k2.6`, reached via the AI SDK (`ai` + `workers-ai-provider`), not raw `env.AI.run`. No Anthropic, no provider switching. |
| `LOADER` (`worker_loaders`)  | yes        | Real Dynamic Workers binding. Smoke-tested with `env.LOADER.load(...)` returning `ok-from-dynamic-worker`. |

---

## 12. Documentation references

Use the Cloudflare Docs MCP for current canonical URLs. Starting points:

### Cloudflare platform

- Workers — https://developers.cloudflare.com/workers/
- `wrangler.jsonc` configuration — https://developers.cloudflare.com/workers/wrangler/configuration/
- Wrangler commands — https://developers.cloudflare.com/workers/wrangler/commands/
- Workers Static Assets — https://developers.cloudflare.com/workers/static-assets/
- SPA routing — https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- D1 — https://developers.cloudflare.com/d1/
- D1 Worker API — https://developers.cloudflare.com/d1/worker-api/
- D1 migrations — https://developers.cloudflare.com/d1/reference/migrations/
- Workers AI — https://developers.cloudflare.com/workers-ai/
- Workers AI bindings — https://developers.cloudflare.com/workers-ai/configuration/bindings/
- Workers AI JSON mode — https://developers.cloudflare.com/workers-ai/features/json-mode/
- `@cf/moonshotai/kimi-k2.6` (generator) — https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/
- `@cf/zai-org/glm-4.7-flash` (classifier) — https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- Artifacts + isomorphic-git — https://developers.cloudflare.com/artifacts/examples/isomorphic-git/
- **Dynamic Workers — https://developers.cloudflare.com/dynamic-workers/**
- Dynamic Workers getting started — https://developers.cloudflare.com/dynamic-workers/getting-started/
- Dynamic Workers API reference — https://developers.cloudflare.com/dynamic-workers/api-reference/
- Dynamic Workers egress control — https://developers.cloudflare.com/dynamic-workers/usage/egress-control/
- Artifacts — https://developers.cloudflare.com/artifacts/
- Artifacts Workers binding — https://developers.cloudflare.com/artifacts/api/workers-binding/
- R2 — https://developers.cloudflare.com/r2/
- Custom domains for Workers — https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

### Front-end

- Vite — https://vitejs.dev/
- React — https://react.dev/
- React Router — https://reactrouter.com/
- Tailwind CSS — https://tailwindcss.com/docs/installation
- `@cloudflare/kumo` — https://kumo-ui.com/
- `@phosphor-icons/react` — https://phosphoricons.com/

### Standards

- CSP — https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- `iframe` sandbox — https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox
- JSON Schema — https://json-schema.org/

### Third-party

- isomorphic-git — https://isomorphic-git.org/docs/en/alphabetic
- nanoid — https://github.com/ai/nanoid

---

<!-- PHASE_2_APPEND_BELOW -->

## Phase 2 — extension system (LIVE)

The dormant extension system is now live. Summary of what was wired and the
decisions made.

### Classifier (gatekeeper)

- Prompt file: `src/prompts/extension-classifier.md` (loaded as a Text module
  — see the `rules` entry in `wrangler.jsonc` + `src/worker/text-modules.d.ts`).
- Model (FIXED): `@cf/zai-org/glm-4.7-flash` via the AI SDK
  `generateObject({ model: workersai("@cf/zai-org/glm-4.7-flash"), schema })`
  (`workers-ai-provider`). No raw `env.AI.run`.
- Schema (zod; the AI SDK validates the output):

  ```json
  {
    "type": "object",
    "required": ["allowed", "reason", "title", "category", "risk_flags"],
    "properties": {
      "allowed":    { "type": "boolean" },
      "reason":     { "type": "string", "maxLength": 280 },
      "title":      { "type": "string", "minLength": 2, "maxLength": 60 },
      "category":   { "type": "string", "enum": ["visual","feature","redesign","other"] },
      "risk_flags": { "type": "array", "items": { "type": "string" } }
    },
    "additionalProperties": false
  }
  ```

- If the classifier call fails (after the internal retry), `POST /submit`
  returns **503** with `classifier_unavailable` — the gate is never skipped.

### Generator

- Prompt file: `src/prompts/extension-generator.md` (Text module).
- Model (FIXED): `@cf/moonshotai/kimi-k2.6` via the AI SDK
  `generateText({ model: workersai("@cf/moonshotai/kimi-k2.6"), tools,
  stopWhen: stepCountIs(8) })`. The AI SDK drives the tool-use loop — no
  hand-rolled `messages`/`tool_calls` loop. Tools (`test_code`,
  `commit_and_push_code`) are `tool({ inputSchema: z…, execute })`.
- Loop + tools live in `src/worker/agent.ts`. `test_code` budget = 4
  iterations (enforced in the tool's `execute`); outer cap =
  `stepCountIs(8)`. On budget exhaustion → extension `status: 'failed'`
  with `reason`.

### Agent execution model (FROZEN)

- **Agents SDK `Agent` (a Durable Object), via `this.schedule` — NOT
  `ctx.waitUntil`.** Generation is multi-minute; `ctx.waitUntil` is
  cancelled shortly after the response returns and strands the row in
  `generating`. `POST /submit` registers the extension as `generating`,
  does `getAgentByName(env.GENERATION_AGENT, extensionId).startGeneration(job)`,
  and returns immediately. `startGeneration` calls
  `this.schedule(0, "runGeneration", job)`; the scheduled callback runs the
  loop in the Agent's own alarm invocation with a fresh budget.

### Real-time mechanism (CHOSEN)

- **Polling (option B)**, for reliability under conference Wi-Fi.
  - `/admin` polls `GET /api/v1/extensions?all=1` + `GET /api/v1/submissions`
    every 3s and toasts on newly-`ready` extensions.
  - `/submit` polls `GET /api/v1/extensions/:id/status` every 2s (90s cap).
- No SSE stream was added.

### Dynamic Workers (NOT a choice — the architecture)

- Both `test_code` (`env.LOADER.load`) and `/x/:id`
  (`env.LOADER.get(`${id}@${sha}`, cb)`) use Dynamic Workers with
  `globalOutbound: null` and **no bindings**. The `/x/:id` response injects
  the browser storage-blocking shim after `<head>` and layers
  `EXTENSION_HEADERS` (CSP etc). The admin preview adds a fourth layer:
  `<iframe sandbox="allow-scripts">`.
- `test_code` log capture is best-effort (`logs: []`); `ok` is gated on
  `status === 200` + non-empty HTML body + no thrown/timeout errors. (The
  Tail-Worker log-capture path was skipped per the prompt's time-tight
  fallback.)

### Artifacts

- `src/worker/artifacts.ts` uses `isomorphic-git` + `src/worker/memory-fs.ts`
  over the repo `remote` + a scoped token (the `ARTIFACTS` binding can only
  create/manage repos + mint tokens). Repo name:
  `ext-<id>-<slug(title)>`. Files: `index.js`, `README.md`, `prompt.json`.

### New endpoints (Phase 2)

- `POST /api/v1/extensions/submit` → real pipeline.
- `GET /api/v1/extensions?all=1` → includes rejected (admin).
- `GET /api/v1/submissions` → all submissions (admin).
- `GET /api/v1/extensions/:id/code` → `{ html, sha }` (index.js source).
- `GET /api/v1/extensions/:id/commits` → `{ commits: [{ sha, message, author, timestamp }] }`.
- `GET /api/v1/extensions/:id/status` now also returns `title`.

### How to debug a failed extension

1. Open `/admin`, find the row, click into `/admin/extensions/:id`.
2. Read the `reason` (failure message / last errors) on the row, and the
   **Code** tab (the committed `index.js`) + **Preview** tab (`/x/:id`).
3. Reproduce by replaying the source through `env.LOADER.load` in a scratch
   route, or call `test_code` (`src/worker/agent.ts`) directly with the code.
4. `bash scripts/reset.sh` clears the registry + submissions to start clean.
