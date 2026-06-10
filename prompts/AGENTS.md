# AGENTS.md

> This file is the canonical version of `AGENTS.md` that the Phase 1 agent
> writes to the repo root. It is consumed by Phase 2 and by the runtime
> extension-generator agent. Replace bracketed `<…>` placeholders with the
> real values picked at provisioning time.

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

The pipeline:

> **Agent (writes code) → Artifacts (stores code + history) → Dynamic Workers (executes code in an on-demand, sandboxed isolate per extension)**

The default UI is "extension zero": it consumes the same public API any
extension does. The data layer never knows about the UI. Each extension
runs in its own Dynamic Worker isolate with `globalOutbound: null` and
no bindings.

Dynamic Workers reference:
https://developers.cloudflare.com/dynamic-workers/

---

## 2. The extension contract (FROZEN)

An extension is **a single self-contained Worker module** — one ES
module string with a `default { fetch(request) }` handler that returns
a `Response` containing one HTML document. The module is loaded by
`env.LOADER.load({ mainModule: 'index.js', modules: { 'index.js': code }, globalOutbound: null })` —
no transpilation, no bundler, no bindings passed in.

Hard rules:

1. **Data only via `/api/v1/*`** on the same origin (called from the
   served HTML, never from inside the Worker module). No other fetch
   destinations.
2. **Fully stateless.** No `localStorage`, `sessionStorage`, `indexedDB`,
   cookies, `caches`, `navigator.serviceWorker`, `BroadcastChannel`, or
   any other persistence — in either the Worker handler or the served
   HTML. Every load is a pure function of (code, API data).
3. **No npm / no imports / no build step.** The Worker module is plain
   ES — no TypeScript, no JSX, no bare-specifier imports (Dynamic
   Workers does not transpile). The served HTML is browser-native ES
   only — no CDN script tags.
4. **No external network.** Same-origin API calls only. The Worker has
   none (`globalOutbound: null`). Images returned by the API may have
   third-party URLs — those are allowed because the API returns them.

These rules are enforced at runtime in four layers (defense in depth):

1. **Dynamic Workers loader posture** — `globalOutbound: null` + no
   bindings = primary safety boundary.
2. **CSP** on the `/x/:id` response.
3. **Inline storage-blocking shim** at the top of the served HTML.
4. **Iframe sandbox** in the admin preview.

---

## 3. Frozen surfaces — do NOT touch

- `/api/v1/records*` response shape (section 4).
- The D1 `records` table schema.
- The extension contract above.
- The `/x/:extensionId` sandbox CSP and the inline storage shim.
- The Dynamic Workers loader posture: `globalOutbound: null`, no
  bindings passed in. Never relax either.
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
  status: 'pending' | 'generating' | 'ready' | 'failed' | 'rejected';
  category: 'visual' | 'feature' | 'redesign' | 'other' | null;
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
- `GET  /api/v1/extensions/:id/status` → `{ id, status, reason?, title? }`
- `GET  /api/v1/extensions/:id/code` → `{ html, sha }` (Phase 2)
- `GET  /api/v1/extensions/:id/commits` → `{ commits: [...] }` (Phase 2)
- `POST /api/v1/extensions/submit` → `{ submission_id, extension_id?, status, title?, reason? }` (Phase 2; Phase 1 returns 501)

`/x/:extensionId` is a Worker route, not an API endpoint. It serves HTML.

---

## 5. Repo conventions

File layout (see Phase 1 prompt §2). Key choices:

- TypeScript strict everywhere except inside extensions (which are plain
  HTML/CSS/JS by contract).
- No default exports except React page components.
- Tailwind via the Kumo preset; never hardcode colors — use
  `text-kumo-*`, `bg-kumo-*` tokens.
- Worker entry is `src/worker/index.ts`. One router; small handler files
  (`api.ts`, `extensions.ts`, `submit.ts`).
- Client-side routing for the UI; server-side routing for `/api/v1/*`
  and `/x/:id`.

### Build & deploy commands

| command                 | what it does                                           |
| ----------------------- | ------------------------------------------------------ |
| `npm run dev`           | Vite + `wrangler dev` in parallel                      |
| `npm run build`         | builds the UI                                          |
| `npm run deploy`        | `npm run build && wrangler deploy`                     |
| `npm run seed`          | runs `scripts/seed.ts` against the remote D1           |
| `bash scripts/reset.sh` | clears extensions + their Artifacts repos; keeps vinyl |

Extensions have no build step.

### Monorepo / packaging choice

`<filled by Phase 1 — e.g. "single root package.json; UI under /src/ui with Vite multi-entry">`

---

## 6. Bindings (in `wrangler.jsonc`)

| name        | type                  | purpose                                                                                            |
| ----------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `assets`    | Workers Static Assets | serves the built React UI                                                                          |
| `DB`        | D1                    | records, extensions, submissions                                                                   |
| `AI`        | Workers AI            | LLM calls (classifier, generator). Phase 2 may also use Anthropic via secret `ANTHROPIC_API_KEY`.  |
| `ARTIFACTS` | Cloudflare Artifacts  | one Git repo per generated extension                                                               |
| `LOADER`    | Dynamic Workers (`worker_loaders`) | executes each extension on demand in an isolated, sandboxed Worker                    |

Env vars:

- `APP_ORIGIN` — the deployed origin, used in CSP and same-origin checks.
- `LOADER_COMPAT_DATE` — the `compatibilityDate` value passed to
  `env.LOADER.load`/`env.LOADER.get`. Pin it so test-time and serve-time
  isolates behave identically.

`wrangler.jsonc` shape for the Dynamic Workers binding (see
https://developers.cloudflare.com/dynamic-workers/getting-started/):

```jsonc
{
  "worker_loaders": [{ "binding": "LOADER" }]
}
```

---

## 7. Artifacts integration

- Binding: `ARTIFACTS`.
- Repo naming: `ext-<extensionId>-<slugified-title>` (slug is
  kebab-case ascii, max 40 chars).
- Repo structure:
  - `index.js` — the extension itself (an ES module string with a
    default `fetch` handler).
  - `README.md` — original prompt + classifier output + metadata.
  - `prompt.json` — structured metadata
    `{ extension_id, title, prompt, classifier:{ allowed, reason, category, risk_flags }, created_at }`.
- Commit messages: `feat: <title>` on first commit;
  `iterate: <title> (attempt N)` on subsequent iterations.
- The registry row stores `artifact_ref`, `last_commit_sha`,
  `last_commit_message`.
- **There is no separate deploy step.** `env.LOADER.get(cacheKey, callback)`
  at `/x/:id` reads the latest source from Artifacts on cache miss, so a
  fresh commit is live the moment it lands. Use the cache key
  `${extensionId}@${last_commit_sha}` to deterministically invalidate
  per commit.

## 7a. Dynamic Workers integration

- Binding: `LOADER` (`worker_loaders` in `wrangler.jsonc`).
- Docs: https://developers.cloudflare.com/dynamic-workers/
- **Serve path** (cached, used by `/x/:extensionId`):
  ```js
  const worker = env.LOADER.get(`${ext.id}@${ext.last_commit_sha}`, async () => {
    const code = await artifacts.readFile(ext.artifact_ref, ext.last_commit_sha, "index.js");
    return {
      compatibilityDate: env.LOADER_COMPAT_DATE,
      mainModule: "index.js",
      modules: { "index.js": code },
      globalOutbound: null,
    };
  });
  return worker.getEntrypoint().fetch(request);
  ```
- **Test path** (one-shot, used by `test_code`):
  ```js
  const worker = env.LOADER.load({
    compatibilityDate: env.LOADER_COMPAT_DATE,
    mainModule: "index.js",
    modules: { "index.js": candidateCode },
    globalOutbound: null,
  });
  const res = await worker.getEntrypoint().fetch(new Request("https://test.local/"), { signal: AbortSignal.timeout(5000) });
  ```
- **Never** pass a `bindings` field. **Never** set `globalOutbound` to
  anything other than `null`. These are frozen.

---

## 8. Agent tools (Phase 2)

### `test_code(code: string)`

Loads a candidate Worker module via `env.LOADER.load(...)` and makes a
synthetic request against it.

Returns:

```ts
{
  ok: boolean;
  status: number;          // HTTP status from the test fetch
  html: string;            // response body (truncated to ~64KB)
  logs: string[];          // console.* captured from the isolate
  errors: string[];        // syntax / thrown / unhandled rejection / policy violation
}
```

Enforces (by virtue of the loader posture):

- `globalOutbound: null` blocks all outbound network from the isolate.
- No bindings are passed in, so the isolate has no D1, no AI, no
  Artifacts, no KV.
- 5-second time budget on the test fetch via `AbortSignal.timeout(5000)`.
  Timeout → `ok: false`, `errors: ["timeout"]`.
- `ok: true` requires `status === 200`, a non-empty HTML body, and no
  captured errors.

`test_code` does not validate the browser-side behavior of the served
HTML (whether the `<script>` inside the document actually fetches
`/api/v1/records`). That is the responsibility of the Step 7 self-test,
which loads `/x/:id` end-to-end and inspects the rendered DOM.

### `commit_and_push_code(input)`

```ts
input: {
  extensionId: string;
  title: string;
  code: string;            // the Worker module source (ES module string)
  readme: string;
  promptJson: object;
}
→ { artifact_ref: string; commit_sha: string; commit_message: string }
```

Creates or reuses the Artifacts repo `ext-<id>-<slug>`, commits the three
files (`index.js`, `README.md`, `prompt.json`), pushes, and returns the
new ref. On retry, commits a new revision to the existing repo. There is
no separate deploy step — `env.LOADER.get` pulls the latest source from
Artifacts on cache miss.

---

## 9. Deployment

- Production hostname: `vinyl.not-a-single-bug.com` (subdomain of the
  already-owned apex `not-a-single-bug.com`).
- Cloudflare account id: `22c98cbfd8d562c6939f5e839d3a1ea3` (existing
  account; no domain registration or payment flow involved). Wire this
  into `wrangler.jsonc` as `account_id`.
- Roll back: `wrangler rollback` to the prior deployment. Resetting
  extensions: `bash scripts/reset.sh`.

---

## 10. What NOT to touch

- The D1 `records` table and `vinyl-data.json`.
- The `/api/v1/records*` response shape.
- The extension contract.
- The `/x/:extensionId` CSP, sandbox flags, and storage-blocking shim.
- The classifier and generator prompts after the talk starts — edit
  before, freeze on stage.

---

## 11. Fallbacks taken during Phase 1

Record here every place where the brief named a product that wasn't
available at provisioning time, and what was used instead. Phase 2 must
read this before starting and use the same fallbacks.

| Brief named                  | Available?  | What we used instead                                    |
| ---------------------------- | ----------- | ------------------------------------------------------- |
| `@cloudflare/kumo`           | `<yes/no>`  | `<e.g. shadcn/ui + Tailwind + lucide-react>`            |
| `ARTIFACTS` binding          | `<yes/no>`  | `<e.g. R2-backed shim at src/worker/artifacts.ts>`      |
| Workers AI binding           | `<yes/no>`  | `<e.g. env.AI.run with @cf/meta/llama-3.3 + JSON mode>` |
| `LOADER` (`worker_loaders`)  | `<yes/no>`  | **No fallback** — Dynamic Workers is load-bearing. If `<no>`, Phase 1 must stop and surface the blocker. |

---

## 12. Documentation references

Use the Cloudflare Docs MCP
(`cloudflare_docs_search_cloudflare_documentation`) for current canonical
URLs. Starting points:

### Cloudflare platform

- Workers — https://developers.cloudflare.com/workers/
- `wrangler.jsonc` configuration —
  https://developers.cloudflare.com/workers/wrangler/configuration/
- Wrangler commands — https://developers.cloudflare.com/workers/wrangler/commands/
- Workers Static Assets — https://developers.cloudflare.com/workers/static-assets/
- SPA routing — https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- D1 — https://developers.cloudflare.com/d1/
- D1 Worker API — https://developers.cloudflare.com/d1/worker-api/
- D1 migrations — https://developers.cloudflare.com/d1/reference/migrations/
- Workers AI — https://developers.cloudflare.com/workers-ai/
- Workers AI bindings — https://developers.cloudflare.com/workers-ai/configuration/bindings/
- Workers AI JSON mode — https://developers.cloudflare.com/workers-ai/features/json-mode/
- OpenAI-compatible endpoint —
  https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
- AI Gateway — https://developers.cloudflare.com/ai-gateway/
- Agents SDK — https://developers.cloudflare.com/agents/
- Agents API — https://developers.cloudflare.com/agents/runtime/agents-api/
- Durable Objects — https://developers.cloudflare.com/durable-objects/
- **Dynamic Workers (the executor for every extension) —
  https://developers.cloudflare.com/dynamic-workers/**
- Dynamic Workers getting started —
  https://developers.cloudflare.com/dynamic-workers/getting-started/
- Dynamic Workers API reference —
  https://developers.cloudflare.com/dynamic-workers/api-reference/
- Dynamic Workers egress control —
  https://developers.cloudflare.com/dynamic-workers/usage/egress-control/
- R2 — https://developers.cloudflare.com/r2/
- R2 Workers API — https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- Custom domains for Workers —
  https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Environment variables —
  https://developers.cloudflare.com/workers/configuration/environment-variables/
- Secrets — https://developers.cloudflare.com/workers/configuration/secrets/
- Compatibility dates / flags —
  https://developers.cloudflare.com/workers/configuration/compatibility-dates/
- `ctx.waitUntil` —
  https://developers.cloudflare.com/workers/runtime-apis/context/
- WebSockets — https://developers.cloudflare.com/workers/runtime-apis/websockets/

### Front-end

- Vite — https://vitejs.dev/
- React — https://react.dev/
- React Router — https://reactrouter.com/
- Tailwind CSS — https://tailwindcss.com/docs/installation
- `@cloudflare/kumo` (intended; verify availability) — https://kumo-ui.com/
- shadcn/ui (fallback) — https://ui.shadcn.com/
- lucide-react — https://lucide.dev/

### Standards

- CSP — https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- `iframe` sandbox —
  https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox
- JSON Schema — https://json-schema.org/

### Third-party (only if used as fallback)

- Anthropic API — https://docs.claude.com/en/api/overview
- nanoid — https://github.com/ai/nanoid

If a link 404s, the product has been renamed — search the Cloudflare
Docs MCP for the new URL and update this file in place.

---

<!-- PHASE_2_APPEND_BELOW -->
