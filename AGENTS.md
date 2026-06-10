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
| `AI`        | Workers AI            | LLM calls (classifier, generator). Phase 2 may also use Anthropic via secret `ANTHROPIC_API_KEY`.  |
| `ARTIFACTS` | Cloudflare Artifacts  | one Git repo per generated extension; namespace `vinyl-app`                                        |
| `LOADER`    | Dynamic Workers (`worker_loaders`) | executes each extension on demand in an isolated, sandboxed Worker                    |

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
"d1_databases": [
  { "binding": "DB", "database_name": "vinyl-app-db", "database_id": "888acc88-a896-402b-a510-b76abdda2496" }
]
```

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
  Phase 2 must implement (commit/push via Git protocol or REST).

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

Creates or reuses the Artifacts repo `ext-<id>-<slug>`, commits the three
files (`index.js`, `README.md`, `prompt.json`), pushes, and returns the new
ref. On retry, commits a new revision to the existing repo. There is no
separate deploy step — `env.LOADER.get` pulls the latest source from
Artifacts on cache miss.

### `callLLMJson<T>(opts)`

Already stubbed in `src/worker/llm.ts`. Phase 2 fills in the actual retry /
validate / repair loop (Workers AI JSON mode or Anthropic via
`ANTHROPIC_API_KEY` secret).

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
| `ARTIFACTS` binding          | yes        | Real Cloudflare Artifacts binding (closed beta — account has access). `src/worker/artifacts.ts` wraps it with a small interface. `createRepo` is wired; `commitFiles` / `readFile` / `listCommits` are stubs Phase 2 implements. |
| Workers AI binding           | yes        | `env.AI` binding declared; Phase 1 doesn't call it. Phase 2 picks model + JSON mode (or swaps to Anthropic via secret `ANTHROPIC_API_KEY`). |
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

### Third-party (only if used as fallback)

- Anthropic API — https://docs.claude.com/en/api/overview
- nanoid — https://github.com/ai/nanoid

---

<!-- PHASE_2_APPEND_BELOW -->
