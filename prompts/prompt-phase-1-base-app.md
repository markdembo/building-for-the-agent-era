# Phase 1 — Build the base vinyl app ("extension zero")

You are a coding agent. Build the entire base application for the talk
"Building for the Agent Era" from zero. This prompt is run BEFORE the talk,
so you have time. Do everything described here. Do not skip steps.

The repo already contains:

- `vinyl-data.json` — 50+ Discogs records (seed data). Use this file directly.
- `example-layout.png` — the visual target for the default UI.
- `prompts/000_init.md` — the brief you were authored from. Do not modify.

When you finish, the next agent (Phase 2, run live on stage) must be able to
build the extension system in under 5 minutes. That means every binding,
every route, every empty hook, every piece of plumbing must already exist.
Phase 2 only fills in logic.

---

## Reality check before you start (read this; don't refuse)

This prompt was written by a human who may name tools and products that
don't exist by that exact name, are still in preview, or are still being
shipped. Don't refuse the work — adapt. Specifically:

- **Cloudflare Artifacts may not yet be a stable binding type in
  `wrangler.jsonc`.** If `wrangler` rejects an `artifacts` binding,
  create a thin abstraction: declare an `ARTIFACTS_*` set of vars (e.g.
  `ARTIFACTS_API_URL`, `ARTIFACTS_TOKEN` as a secret) and implement
  `src/worker/artifacts.ts` with a small interface
  (`createRepo`, `commitFiles`, `listCommits`, `readFile`) that Phase 2
  calls. Back it with whatever storage is available today — R2
  (https://developers.cloudflare.com/r2/) plus a tiny git-like layout
  (commits as JSON manifests pointing at content-addressed blobs) is a
  reasonable fallback if the real Artifacts product isn't reachable.
  Document the choice in `AGENTS.md` so Phase 2 can rely on the same
  interface either way.
- **Dynamic Workers (`worker_loaders` binding) may be experimental.**
  Try the documented config first
  (`{ "worker_loaders": [{ "binding": "LOADER" }] }` — see
  https://developers.cloudflare.com/dynamic-workers/getting-started/).
  Confirm by running the smoke test described in verification step 11.
  If the binding type isn't recognized by the installed `wrangler`
  version, run `npm i -g wrangler@latest` and retry; if it still fails,
  check the account is on a plan that supports Dynamic Workers and ask
  the human. Do **not** fall back to a different execution model —
  Dynamic Workers is the load-bearing primitive for the entire
  extension system, so a missing binding is a hard stop, not a swap.
  Surface it clearly and wait.
- **`@cloudflare/kumo` may not be a public npm package at run time.**
  Try `npm view @cloudflare/kumo` first. If it isn't published, build the
  UI with shadcn/ui + Tailwind + lucide-react as a drop-in substitute —
  same visual goals, same component names where possible
  (`Sidebar`, `Card`, `Badge`, `Tabs`, `Input`, `Dialog`, `Table`,
  `Button`, plus a Prism-based code highlighter for the admin Code tab).
  The visual target in `example-layout.png` is the contract; the
  component library is implementation detail. Document the substitution
  in `AGENTS.md` so Phase 2 uses the same primitives.
- **Cloudflare account + domain are already provided.** The human is
  already authenticated to a Cloudflare account
  (`account_id = "22c98cbfd8d562c6939f5e839d3a1ea3"` —
  wire this into `wrangler.jsonc`). `wrangler whoami` should return a
  real identity for that account. The apex `not-a-single-bug.com` is
  already owned in this account; the production hostname for this app
  is the subdomain `vinyl.not-a-single-bug.com`. Do not register a new
  domain, propose alternatives, or run any payment flow. Attach the
  subdomain via `wrangler.jsonc` custom-domain routing — no separate
  registration is needed.

When you hit any of these, surface the blocker clearly, choose a
documented fallback, write the choice into `AGENTS.md`, and keep moving.
Don't silently swap things; don't refuse the task.

---

## 0. One-paragraph goal (read this first)

Build a personal vinyl collection viewer on Cloudflare Workers. Vinyl data
lives in D1 and is exposed only through a versioned, read-only JSON API.
The default UI is a React + Vite + Kumo app that consumes that API — it is
"extension zero". Build a complete but dormant extension system: registry
table; a loader route `/x/:extensionId` whose execution path uses the
**Dynamic Workers** Worker Loader binding (`env.LOADER`) — see
https://developers.cloudflare.com/dynamic-workers/ — so each extension
runs in its own on-demand, sandboxed isolate with `globalOutbound: null`
and no bindings; a submission page `/submit` (the QR target) that posts
to a stub endpoint returning 501. Pre-create every Cloudflare binding
Phase 2 will need (Artifacts, AI, D1, Worker Loader). Deploy to the
already-owned domain `vinyl.not-a-single-bug.com` on the human's
existing Cloudflare account. Write `AGENTS.md` at the repo root so
Phase 2 and the runtime generator agent inherit context. End with a
self-executed verification checklist.

---

## 1. Provisioning — existing Cloudflare account, existing domain

The human is already authenticated to a Cloudflare account. The apex
`not-a-single-bug.com` is already owned in that account; this app
deploys to the subdomain `vinyl.not-a-single-bug.com`. Do not register
a new domain, do not propose alternatives, do not run any payment flow.

1. Run `wrangler whoami`
   (https://developers.cloudflare.com/workers/wrangler/commands/#whoami).
   It must return a real identity for account
   `22c98cbfd8d562c6939f5e839d3a1ea3`. If it does not, stop and ask the
   human to run `wrangler login`
   (https://developers.cloudflare.com/workers/wrangler/commands/#login)
   — do not attempt to authenticate on their behalf. Set
   `"account_id": "22c98cbfd8d562c6939f5e839d3a1ea3"` in
   `wrangler.jsonc`.
2. Use `vinyl.not-a-single-bug.com` as the production hostname. Add it
   as a custom domain in `wrangler.jsonc` per
   https://developers.cloudflare.com/workers/configuration/routing/custom-domains/.
   The apex zone is already on Cloudflare, so no DNS provider changes
   are needed; the subdomain is created automatically when the route is
   attached. It is fine to deploy to a workers.dev subdomain first for
   smoke testing, then attach the custom domain.
3. Save `vinyl.not-a-single-bug.com` into `AGENTS.md` under "Deployment".

Do not proceed past this step until `wrangler deploy` succeeds and a
hello-world Worker is reachable on `https://vinyl.not-a-single-bug.com`.

---

## 2. Repo layout

Create exactly this layout. Prefer few clear files over clever abstractions.

```
/                          repo root
  wrangler.jsonc           single Worker, Static Assets, D1, AI, Artifacts bindings
  package.json             root: scripts for dev/build/deploy/seed/reset
  vinyl-data.json          (already present — do not modify)
  example-layout.png       (already present — visual reference)
  AGENTS.md                written by you, see section 7
  README.md                short: how to dev, deploy, reset
  tsconfig.json
  /src
    /worker
      index.ts             Worker entry: routes /api/v1/*, /x/:id, /submit asset passthrough
      api.ts               read-only data API handlers
      extensions.ts        extension registry handlers + /x/:id loader
      submit.ts            POST /api/v1/extensions/submit stub (501)
      db.ts                D1 helpers
      types.ts             shared types (Record, Extension, etc.)
    /prompts
      .gitkeep             (Phase 2 will add extension-generator.md here)
    /ui                    React + Vite + Kumo app (the default UI)
      index.html
      vite.config.ts
      tsconfig.json
      package.json         (workspace child; or single root package — your call, document it)
      /src
        main.tsx
        App.tsx
        routes.tsx
        /pages
          CollectionPage.tsx
          ExtensionsPage.tsx
          SubmitPage.tsx        served at /submit (mobile-first)
        /components
          RecordCard.tsx
          RecordDialog.tsx
          AppSidebar.tsx
          AppHeader.tsx
        /lib
          api.ts                typed fetch client for /api/v1/*
          genres.ts             genre → Badge variant mapping
        /styles
          tailwind.css          Kumo theme tokens
  /scripts
    seed.ts                read vinyl-data.json → insert into D1
    reset.sh               clears extensions + their Artifacts repos, keeps vinyl
  /migrations
    0001_init.sql          records + extensions + submissions tables
```

If you choose a monorepo (recommended: root `package.json` with `ui` as a
workspace, or a single root package — either is fine), document the choice
in `AGENTS.md`. The Worker serves the built UI via Workers Static Assets
(`assets` binding in `wrangler.jsonc`, with the build output directory).

---

## 3. Data layer — D1, read-only API

### Schema (`migrations/0001_init.sql`)

```sql
CREATE TABLE records (
  id            INTEGER PRIMARY KEY,        -- Discogs id from vinyl-data.json
  artist        TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  year          INTEGER,
  genres        TEXT    NOT NULL,            -- JSON array
  styles        TEXT    NOT NULL,            -- JSON array
  format        TEXT,
  vinyl_color   TEXT,
  cover_image   TEXT    NOT NULL,
  thumbnail     TEXT    NOT NULL,
  discogs_url   TEXT,
  rating        INTEGER,
  date_added    TEXT    NOT NULL
);

CREATE TABLE extensions (
  id                   TEXT PRIMARY KEY,     -- short id, e.g. nanoid(10)
  title                TEXT NOT NULL,
  prompt               TEXT NOT NULL,
  status               TEXT NOT NULL,        -- 'pending' | 'generating' | 'ready' | 'failed' | 'rejected'
  category             TEXT,                  -- 'visual' | 'feature' | 'redesign' | 'other'
  reason               TEXT,                  -- rejection or failure reason
  artifact_ref         TEXT,                  -- Artifacts repo identifier
  last_commit_sha      TEXT,
  last_commit_message  TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE submissions (
  id           TEXT PRIMARY KEY,
  prompt       TEXT NOT NULL,
  extension_id TEXT,                          -- FK if allowed
  status       TEXT NOT NULL,                 -- 'received' | 'allowed' | 'rejected'
  reason       TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_extensions_status ON extensions(status);
CREATE INDEX idx_extensions_created_at ON extensions(created_at DESC);
```

### Seeding

`scripts/seed.ts` reads `vinyl-data.json` and inserts every row into
`records`. Make seeding idempotent (`INSERT OR REPLACE`). Wire as
`npm run seed`. Run it as part of deployment.

### API (the single boundary)

All under `/api/v1/`. JSON only. No write endpoints on data. CORS:
same-origin only (extensions run on the same origin via `/x/:id`, so they
inherit it; no need to allow cross-origin).

- `GET /api/v1/records` → `{ records: Record[] }` — all records.
  Optional query: `?genre=Rock&style=Indie+Rock&q=substring`. Keep it simple
  — server-side filter, no pagination needed for 50 rows.
- `GET /api/v1/records/:id` → `{ record: Record }` or 404.
- `GET /api/v1/extensions` → `{ extensions: Extension[] }` — only rows where
  `status IN ('ready','generating','failed')`. Empty array in Phase 1.
- `GET /api/v1/extensions/:id` → single extension or 404. Returns 404 in
  Phase 1.
- `GET /api/v1/extensions/:id/status` → `{ id, status, reason?, extension_id? }`
  — used by `/submit` to poll. Returns 404 in Phase 1.
- `POST /api/v1/extensions/submit` → **stub**: accept
  `{ prompt: string }`, validate it's a non-empty string ≤ 2000 chars,
  return HTTP 501 with body
  `{ error: "not_implemented", message: "The platform doesn't exist yet — come to the talk." }`.
  No DB writes in Phase 1.

The `Record` shape returned by the API (camelCase, exactly this):

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
```

This shape is **frozen**. Document it as frozen in `AGENTS.md`. Extensions
depend on it.

---

## 4. The default UI — React + Vite + Kumo

This is the one place a build step is allowed. Extensions remain
vanilla HTML/CSS/JS.

### Setup

- Vite + React + TypeScript.
- Install `@cloudflare/kumo` and follow https://kumo-ui.com setup
  (Tailwind preset, theme tokens). Configure Tailwind with the Kumo preset.
- Dark mode preferred by default; respect `prefers-color-scheme` but ship
  with dark as the initial theme.
- Build output served via Workers Static Assets.

### Visual target

Match `example-layout.png`:

- Centered page title "Vinyl Collection" with a record count subtitle.
- 5-column grid of large square album covers on desktop; responsive to 1–2
  on phone, 3–4 on projector widths.
- Album cover dominates the card. Artist + title + year are secondary text
  below the cover.
- Clean background, generous spacing, hover lift on cards.

Visual priority is "image gallery, not data table." Covers must be large
and crisp on a projector.

### Routes (client-side, react-router)

- `/` → `CollectionPage` (the showcase).
- `/extensions` → `ExtensionsPage` (Kumo `Table` listing extensions;
  `Empty` state in Phase 1: "None yet — soon you'll prompt your own").
- `/submit` → `SubmitPage` (mobile-first; the QR target).

### Kumo components — required usage

Use these exact components from `@cloudflare/kumo` (and
`@cloudflare/kumo/code` for `CodeHighlighted`). Reference https://kumo-ui.com
for current APIs.

- `Sidebar` — app navigation. Sections:
  - "Collection" (active by default)
  - "Extensions" (with `MenuBadge` showing the extension count — 0 in
    Phase 1)
  - "Submit" — link to `/submit`
- `PageHeader` block — title bar with breadcrumbs and description text on
  each page.
- `Banner` — on the Collection page, show:
  > This app's UI is just "extension zero" — audience members will prompt
  > their own views into existence.
- `Grid` — responsive grid for the record collection.
- `LayerCard` — each record:
  - Hero: the album `coverImage`.
  - `LayerCard.Secondary`: artist name.
  - `LayerCard.Primary`: album title.
  - Footer-ish line: year + `Badge`s for genres.
  - Click → open `Dialog` with the full record detail.
- `Badge` — genre badges. Map genre → variant via `lib/genres.ts`:
  - `electronic` → `purple`
  - `jazz` → `blue`
  - `rock` → `orange`
  - `soul`, `funk` → `teal`
  - anything else → `neutral`
  Matching is case-insensitive on the first genre token (or any token; pick
  the first match). Document the mapping.
- `Tabs` (segmented variant) — filter the grid by genre and a "Now spinning"
  pseudo-filter (Phase 1: "Now spinning" filters to records added in the
  last 30 days; this is a placeholder for the demo's vibe).
- `Input` — search bar at the top of `CollectionPage`. Filters client-side
  on artist/title substring.
- `Dialog` — record detail. Big cover, all fields, link to `discogsUrl`.
- `Loader` — shown while the records list is loading.
- `Button` — primary actions, including the Submit button on `/submit`.
- `Empty` — zero state on `ExtensionsPage`. Icon + message
  "None yet — soon you'll prompt your own."
- `Table` — `ExtensionsPage` list (empty in Phase 1; structure must be
  ready so Phase 2 only adds rows). Columns: Title, Status (Badge dot
  variant), Created.
- `Toast` — feedback on `/submit` actions (e.g. 501 friendly message).
- `CodeHighlighted` (from `@cloudflare/kumo/code`) — **import and render
  once on a hidden route or behind a feature flag** so Vite includes it in
  the bundle. Phase 2 needs it on day one and must not have to add deps.

Use Kumo theme tokens: `text-kumo-subtle`, `text-kumo-default`,
`bg-kumo-base`, `bg-kumo-elevated`. Do not hardcode hex colors.

### `/submit` page (mobile-first, polished)

- `PageHeader` with title "Prompt an extension".
- One-sentence explanation: "Describe a change to this app. An agent will
  build it as a personal view for you."
- Kumo `InputArea` (or `Input` if `InputArea` is unavailable) for the
  prompt (placeholder: e.g. "make the album covers spin slowly"). Max
  length 2000.
- `Button` "Generate" — `POST /api/v1/extensions/submit`.
- On 501: show a `Banner` variant="default" with the friendly message and
  also a `Toast`. Phase 2 will replace this behavior.
- Must look good on a phone in portrait. Touch targets ≥ 44px.

### Extensions page

- `PageHeader` + `Table` + `Empty`.
- Wire the data fetch to `GET /api/v1/extensions`; render the `Empty`
  state when the list is empty (Phase 1: always).

---

## 5. The extension hook system — built but empty

### Loader route

`GET /x/:extensionId` — Worker route (not a client-side route).

Phase 1 behavior: always serve a styled HTML placeholder. Same visual
language as the main app but standalone (no React; this is plain HTML so
Phase 2 can swap the body in without rewiring). The placeholder must
include the literal copy:

> No extensions yet — soon you'll prompt your own.

Plumbing requirements (must exist in Phase 1, even if unused):

- Resolution function `resolveExtension(id)` in `src/worker/extensions.ts`
  that looks up the row in `extensions` and returns
  `{ status, artifact_ref, last_commit_sha } | null`. In Phase 1 it always
  returns `null`.
- The route handler is structured so Phase 2 only fills in two things:
  (a) a `loadExtensionSource(artifact_ref, sha)` call that reads
  `index.js` from the Artifacts repo, and
  (b) the Dynamic Workers invocation
  `env.LOADER.get(extensionId, async () => ({ mainModule: 'index.js', modules: { 'index.js': code }, compatibilityDate: <today>, globalOutbound: null })).getEntrypoint().fetch(request)`.
  Leave a single clearly-marked comment block at that exact spot:
  `// PHASE_2: load extension source from Artifacts and invoke env.LOADER`.
  In Phase 1 the route bypasses both and serves the placeholder for any
  id.
- Response headers for both the placeholder AND the Phase 2 execution
  path (the main Worker re-serves whatever the Dynamic Worker returns,
  with these headers layered on top):
  - `Content-Security-Policy: default-src 'self'; connect-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self';`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy: interest-cohort=()`
- The route must accept any `:extensionId` and return the placeholder for
  unknown ids (not 404). It's part of the show.
- **Defense in depth.** Dynamic Workers + `globalOutbound: null` + no
  bindings is the primary safety boundary. CSP and headers are
  belt-and-braces. Both must be present.

### Registry

Already in the schema (section 3). Confirm the `GET /api/v1/extensions`
endpoint returns an empty array.

### Extension contract (documented in `AGENTS.md`)

An extension is a **single self-contained Worker module** (one
JavaScript ES module, passed as a string to the Worker Loader). It must
export a default object with a `fetch(request)` handler that returns a
`Response` containing one HTML document (HTML+CSS+JS inline).

Hard rules:

1. **Data only via the public API.** The returned HTML fetches
   exclusively from `/api/v1/*` on the same origin. No other fetch
   destinations.
2. **Fully stateless.** No `localStorage`, `sessionStorage`, `indexedDB`,
   cookies, `caches`, `navigator.serviceWorker`, `BroadcastChannel`, or
   any other persistence — in either the Worker handler or the served
   HTML. Every load is a pure function of (code, API data).
3. **No npm / no imports / no build step.** The Worker module is plain
   ES (no TypeScript, no JSX, no bare-specifier imports — Dynamic
   Workers accepts module source as a string and does not transpile).
   The served HTML is browser-native ES only — no CDN script tags.
4. **No external network.** Same-origin API calls only. No third-party
   fonts, scripts, or fetches. (Images returned by the API may have
   third-party URLs — those are allowed because the API returns them.)

These rules are enforced at runtime by the Dynamic Workers loader
configuration (`globalOutbound: null`, no bindings passed in) and by
the loader-route CSP. State the four rules verbatim in `AGENTS.md`.

---

## 6. Pre-created bindings — wire everything Phase 2 needs

In `wrangler.jsonc`, create and bind ALL of the following — even ones
only Phase 2 uses. The live demo must never block on provisioning.

- `assets` — Workers Static Assets pointing at the built UI directory.
- `DB` — D1 database (created, migrated, seeded).
- `AI` — Workers AI binding. Phase 2 uses FIXED Workers AI models via
  `env.AI.run` — classifier `@cf/zai-org/glm-4.7-flash`, generator
  `@cf/moonshotai/kimi-k2.6`. No Anthropic, no provider switching, no
  secret API key. Just create the `AI` binding now.
- `ARTIFACTS` — Cloudflare Artifacts binding (Git-compatible code storage).
  Create the binding even though Phase 1 doesn't use it. If the Artifacts
  product requires creating a "container" or "namespace" up front, do that
  too and record the names in `AGENTS.md`.
- `LOADER` — **Dynamic Workers** Worker Loader binding
  (`worker_loaders` in `wrangler.jsonc` — see
  https://developers.cloudflare.com/dynamic-workers/getting-started/).
  This binding doesn't reference an external resource; declaring it
  enables the Worker Loader API. Required shape:
  ```jsonc
  "worker_loaders": [{ "binding": "LOADER" }]
  ```
  Phase 1 doesn't invoke it. Phase 2 uses it both for `test_code`
  (via `env.LOADER.load(...)`, one-shot) and for serving extensions at
  `/x/:id` (via `env.LOADER.get(id, callback)`, cached).
- An environment variable `APP_ORIGIN` set to the deployed domain (used by
  the extension sandbox CSP).

Create the actual Cloudflare resources (D1 database, AI gateway if used,
Artifacts namespace) via `wrangler` — do not leave the user to do it.
Verify with `wrangler whoami` and a `wrangler d1 execute --remote` smoke
query.

---

## 7. `AGENTS.md` — write it now

Create `AGENTS.md` at the repo root. It is consumed by Phase 2 AND by the
runtime extension-generator agent. Keep it tight; one screen of
architecture map plus reference sections.

Required sections, in this order:

1. **Architecture map (one screen)** — a diagram, as ASCII or a short
   bulleted flow:
   `D1 (records) → read-only /api/v1 → [ default UI: React+Vite+Kumo ] / [ extensions: Worker modules in Artifacts → executed on demand via env.LOADER at /x/:id ]`.
2. **The extension contract** — the four rules from section 5, verbatim.
3. **Frozen surfaces (do NOT touch)** — the `/api/v1/records*` shape, the
   D1 `records` table, the extension contract itself.
4. **Repo conventions** — file layout (paste section 2), naming, code
   style (TypeScript strict, no default exports except React pages).
5. **Build & deploy commands** —
   - `npm run dev` (Vite + `wrangler dev` together; document how)
   - `npm run build` (UI build)
   - `npm run deploy` (build + `wrangler deploy`)
   - `npm run seed` (D1 seed from `vinyl-data.json`)
   - `bash scripts/reset.sh` (clear extensions + their Artifacts repos,
     keep vinyl)
   - Extensions have no build step.
6. **Bindings** — list every binding name from `wrangler.jsonc` with a
   one-line purpose.
7. **Artifacts integration** — binding name (`ARTIFACTS`), repo naming
   convention `ext-<extensionId>-<slugified-title>`, repo structure
   (`index.js` — the Worker module — plus `README.md`, optional
   `prompt.json`).
8. **Dynamic Workers integration** — link to
   https://developers.cloudflare.com/dynamic-workers/getting-started/,
   the `worker_loaders` binding shape (`{ "binding": "LOADER" }`),
   the loader posture used by `/x/:extensionId`:
   `env.LOADER.get(extensionId, async () => ({ mainModule: 'index.js', modules: { 'index.js': code }, compatibilityDate, globalOutbound: null }))`
   — note that no `bindings` are passed in, so the isolate has no D1,
   no AI, no Artifacts, no KV. Document `env.LOADER.load(...)` as the
   one-shot variant used by `test_code` in Phase 2.
9. **Agent tools (Phase 2)** — describe `test_code` and
   `commit_and_push_code`:
   - `test_code(code: string) → { ok: boolean, status: number, html: string, logs: string[], errors: string[] }`
     — calls `env.LOADER.load({ mainModule: 'index.js', modules: { 'index.js': code }, globalOutbound: null })`, sends a synthetic request, captures the response body + console output + thrown errors.
   - `commit_and_push_code(extensionId, title, code, readme, promptJson)`
     — creates or reuses Artifacts repo `ext-<id>-<slug>`, commits the
     files (`index.js`, `README.md`, `prompt.json`), returns
     `{ artifact_ref, commit_sha, commit_message }`. No separate deploy
     step — `env.LOADER.get` pulls fresh source on cache miss.
10. **Deployment** — production hostname `vinyl.not-a-single-bug.com`,
    Cloudflare account id `22c98cbfd8d562c6939f5e839d3a1ea3`, how to
    roll back via `wrangler rollback`.
11. **A "what NOT to touch" list** — data layer, API contract, extension
    contract, sandbox CSP, Dynamic Workers loader posture
    (`globalOutbound: null`, no bindings).

Phase 2 will append a section on the extension-generator system prompt;
leave a `<!-- PHASE_2_APPEND_BELOW -->` marker at the bottom of the file.

---

## 8. Idempotency & reset

Both prompts will be run multiple times during rehearsal.

- Seeding uses `INSERT OR REPLACE` — re-running is safe.
- `scripts/reset.sh` must:
  - Delete all rows from `extensions` and `submissions` in D1 (remote).
  - Delete all Artifacts repositories whose names start with `ext-`.
  - Leave `records` untouched.
  - Print a clear summary of what it deleted.
- Phase 1 must be safely re-runnable: detect existing resources (D1 db,
  Artifacts namespace) by name and reuse instead of recreating. The
  apex `not-a-single-bug.com` is already on the account; the subdomain
  `vinyl.not-a-single-bug.com` is configured via `wrangler.jsonc` —
  never attempt to register, transfer, or purchase a domain.

---

## 9. Structured LLM output, even in Phase 1

You make zero LLM calls in Phase 1 — but the helper you'll leave for
Phase 2 should already exist. Create `src/worker/llm.ts` exporting:

```ts
export async function callLLMJson<T>(opts: {
  env: Env;
  system: string;
  user: string;
  schema: /* JSON Schema or zod-shaped */ unknown;
  maxRetries?: number; // default 1
}): Promise<T>;
```

Implementation in Phase 1: throw `not_implemented`. Phase 2 fills it in.
Including this stub means Phase 2 doesn't have to think about retry/
validation plumbing — only the prompt.

---

## 10. Self-verification checklist (run this; do not skip)

After everything above, the agent must execute the following checks and
report PASS/FAIL for each. Fix any FAIL before declaring done.

1. `npm run build` succeeds with zero errors.
2. `npm run deploy` succeeds; `https://vinyl.not-a-single-bug.com` serves a
   200 at `/`.
3. `curl https://vinyl.not-a-single-bug.com/api/v1/records | jq '.records | length'`
   is ≥ 50.
4. `curl https://vinyl.not-a-single-bug.com/api/v1/records/<known-id>` returns
   the camelCase shape from section 3.
5. `curl https://vinyl.not-a-single-bug.com/api/v1/extensions` returns
   `{"extensions":[]}`.
6. `curl -X POST https://vinyl.not-a-single-bug.com/api/v1/extensions/submit -H 'content-type: application/json' -d '{"prompt":"test"}' -i`
   returns HTTP `501` with the friendly message body.
7. `curl https://vinyl.not-a-single-bug.com/x/anything-here` returns 200 with
   the placeholder HTML containing the exact string
   "No extensions yet — soon you'll prompt your own."
8. The deployed `/submit` page loads cleanly on a phone (test with a real
   device or device-emulation; check touch target sizes and that the
   prompt input is reachable above the keyboard).
9. The deployed `/` shows large album covers in a grid matching
   `example-layout.png` proportions; the Banner about "extension zero" is
   visible; the Extensions sidebar entry shows count 0.
10. `wrangler.jsonc` declares bindings: `assets`, `DB`, `AI`, `ARTIFACTS`,
    `LOADER` (under `worker_loaders`), and env var `APP_ORIGIN`. Confirm
    with `wrangler deployments list` or `wrangler.jsonc` diff.
11. The `LOADER` binding is wired correctly: deploy a temporary smoke
    test that calls
    `env.LOADER.load({ mainModule: 'index.js', modules: { 'index.js': "export default { fetch(){ return new Response('ok-from-dynamic-worker'); } };" }, globalOutbound: null, compatibilityDate: '<today>' }).getEntrypoint().fetch(new Request('https://x/'))`
    and asserts the response body is `ok-from-dynamic-worker`. Remove
    the smoke test before declaring done. This is the most important
    check — if Dynamic Workers isn't actually wired, Phase 2 cannot
    serve any extension.
12. `AGENTS.md` exists at the repo root and contains all 11 required
    sections (section 7).
13. `bash scripts/reset.sh` runs successfully on a freshly-deployed
    instance and leaves the records table intact (re-check #3 after).
14. Re-running this entire Phase 1 prompt is a no-op aside from
    redeployment (no domain changes, no duplicate D1 db).

When all 14 PASS, print a short summary including the production
hostname (`vinyl.not-a-single-bug.com`), the D1 database name, the
Artifacts namespace (or shim backing), the `LOADER` binding status, and
the list of bindings. This summary is what the human will paste into the
Phase 2 prompt context on stage.

---

## Non-goals for Phase 1 (do NOT do these)

- Do not implement the gatekeeper classifier.
- Do not implement the generation agent or its tools.
- Do not write or stub `src/prompts/extension-generator.md` — Phase 2
  writes that file.
- Do not add auth.
- Do not add analytics.
- Do not change `vinyl-data.json`.
- Do not invent write endpoints on `/api/v1/records*`.

---

## Documentation references

Use the Cloudflare Docs MCP (`cloudflare_docs_search_cloudflare_documentation`)
whenever you need to verify a binding shape, a CLI flag, or a runtime API.
Treat the URLs below as starting points, not the whole story — search the
docs MCP for the current version of any page.

### Cloudflare platform (verified live)

- Workers overview — https://developers.cloudflare.com/workers/
- `wrangler.jsonc` configuration (bindings, vars, compatibility dates) —
  https://developers.cloudflare.com/workers/wrangler/configuration/
- Wrangler commands reference (login, deploy, dev, secret, d1) —
  https://developers.cloudflare.com/workers/wrangler/commands/
- Workers Static Assets — https://developers.cloudflare.com/workers/static-assets/
- Static Assets binding + `run_worker_first` / SPA routing —
  https://developers.cloudflare.com/workers/static-assets/binding/
  and https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- D1 overview — https://developers.cloudflare.com/d1/
- D1 Workers binding API — https://developers.cloudflare.com/d1/worker-api/
- D1 migrations (`wrangler d1 migrations`) —
  https://developers.cloudflare.com/d1/reference/migrations/
- Workers AI — https://developers.cloudflare.com/workers-ai/
- Workers AI bindings (`env.AI.run(...)`) —
  https://developers.cloudflare.com/workers-ai/configuration/bindings/
- Workers AI JSON mode / structured outputs —
  https://developers.cloudflare.com/workers-ai/features/json-mode/
- `@cf/moonshotai/kimi-k2.6` (generator) —
  https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/
- `@cf/zai-org/glm-4.7-flash` (classifier) —
  https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- Environment variables and secrets —
  https://developers.cloudflare.com/workers/configuration/environment-variables/
  and https://developers.cloudflare.com/workers/configuration/secrets/
- Compatibility dates and flags —
  https://developers.cloudflare.com/workers/configuration/compatibility-dates/
- **Dynamic Workers (load-bearing for the extension system) —
  https://developers.cloudflare.com/dynamic-workers/**
- Dynamic Workers getting started (`env.LOADER.load`,
  `env.LOADER.get`, `worker_loaders` binding) —
  https://developers.cloudflare.com/dynamic-workers/getting-started/
- Dynamic Workers API reference (modules, `globalOutbound`,
  `WorkerCode` shape) —
  https://developers.cloudflare.com/dynamic-workers/api-reference/
- Dynamic Workers bindings + egress control —
  https://developers.cloudflare.com/dynamic-workers/usage/bindings/
  and https://developers.cloudflare.com/dynamic-workers/usage/egress-control/
- R2 (use as a fallback if Artifacts is not available) —
  https://developers.cloudflare.com/r2/ and
  https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- Custom domains for Workers —
  https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

### Front-end stack (verify availability before committing)

- Vite — https://vitejs.dev/
- React — https://react.dev/
- React Router — https://reactrouter.com/
- Tailwind CSS — https://tailwindcss.com/docs/installation
- `@cloudflare/kumo` (intended UI lib; **verify with `npm view @cloudflare/kumo`
  before relying on it**) — https://kumo-ui.com/ (if unreachable, fall back
  to shadcn/ui as described in the Reality Check section).
- shadcn/ui (fallback component library) — https://ui.shadcn.com/
- lucide-react icons — https://lucide.dev/

### Other

- nanoid (id generation) — https://github.com/ai/nanoid
- JSON Schema — https://json-schema.org/

If any URL above 404s when you fetch it, that means the product was renamed
or restructured. Search the Cloudflare Docs MCP for the current canonical
URL before assuming the feature is gone.
