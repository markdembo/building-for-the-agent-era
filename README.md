# Vinyl Collection — Building for the Agent Era

Phase 1 base app for the conference talk. The default UI is "extension
zero": a React + Vite + Kumo app that consumes the same public JSON API
that audience-generated extensions will. Each extension runs in its own
Dynamic Worker isolate, served at `/x/:extensionId`.

See [`AGENTS.md`](./AGENTS.md) for the architecture, contract, and what
NOT to touch.

## Architecture

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

> **Agent (writes code) → Artifacts (stores code + history) → Dynamic
> Workers (executes code in an on-demand, sandboxed isolate per
> extension)**

The default UI is "extension zero": it consumes the same public API any
audience-generated extension does. Each extension runs in its own Dynamic
Worker isolate with `globalOutbound: null` and no bindings.

## Quick start

```bash
npm install
npm run migrate          # remote D1 migrations (one-time)
npm run seed             # load vinyl-data.json into D1 (idempotent)
npm run dev              # Vite + wrangler dev together
npm run deploy           # build UI + wrangler deploy
```

Production: <https://vinyl.not-a-single-bug.com>
Workers.dev: <https://vinyl-app.not-a-single-bug.workers.dev>

## Reset between rehearsals

```bash
bash scripts/reset.sh    # clears extensions + submissions; keeps records
```
