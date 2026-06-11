import type { Env } from "./types";
import { getExtension } from "./db";
import { getArtifacts } from "./artifacts";

// Inline shim injected into every served extension document. Belt-and-braces:
// the Dynamic Worker isolate already has no storage, but this blocks the
// browser-side persistence APIs in the rendered document too.
const STORAGE_SHIM = `<script>
  (() => {
    const block = () => { throw new Error('persistence is not allowed in extensions'); };
    try { Object.defineProperty(window, 'localStorage',   { get: block, configurable: false }); } catch {}
    try { Object.defineProperty(window, 'sessionStorage', { get: block, configurable: false }); } catch {}
    try { Object.defineProperty(document, 'cookie',       { get: () => '', set: block, configurable: false }); } catch {}
    try { delete window.indexedDB; } catch {}
    try { delete window.caches; } catch {}
    try { delete window.BroadcastChannel; } catch {}
    // Reading navigator.serviceWorker THROWS in a sandboxed (opaque-origin)
    // iframe, so the access itself must be guarded.
    try {
      if (navigator.serviceWorker) {
        try { Object.defineProperty(navigator, 'serviceWorker', { get: block, configurable: false }); } catch {}
      }
    } catch {}
  })();
</script>`;

// Headers layered on top of every /x/:id response. Defense in depth:
// Dynamic Workers + globalOutbound:null is the primary boundary; CSP and
// the other headers are belt-and-braces.
export const EXTENSION_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; connect-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self';",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "interest-cohort=()",
};

// GET /x/:extensionId. Ready extensions are executed in a Dynamic Worker
// isolate; everything else gets the styled placeholder with a status hint.
export async function handleExtensionRoute(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const row = await getExtension(env, id);

  if (!row) return placeholderResponse("no extensions yet");

  if (row.status !== "ready" || !row.artifact_ref || !row.last_commit_sha) {
    return placeholderResponse(row.status, id);
  }

  // Ready → load the source from Artifacts and run it as a Dynamic Worker.
  const artifacts = getArtifacts(env);
  const cacheKey = `${id}@${row.last_commit_sha}`;
  const worker = env.LOADER.get(cacheKey, async () => {
    const code = await artifacts.readFile(
      row.artifact_ref!,
      row.last_commit_sha!,
      "index.js"
    );
    return {
      compatibilityDate: env.LOADER_COMPAT_DATE,
      mainModule: "index.js",
      modules: { "index.js": code },
      globalOutbound: null, // FROZEN — no outbound network
      // no `bindings`: the isolate has no D1 / AI / Artifacts access
    };
  });

  const inner = await worker.getEntrypoint().fetch(request);
  return injectShimAndLayer(inner);
}

// Read the inner HTML, inject the storage-blocking shim after <head>, and layer
// on the sandbox headers.
async function injectShimAndLayer(inner: Response): Promise<Response> {
  const contentType = inner.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return layerHeaders(inner);
  }
  let html = await inner.text();
  const headIdx = html.search(/<head[^>]*>/i);
  if (headIdx !== -1) {
    const insertAt = html.indexOf(">", headIdx) + 1;
    html = html.slice(0, insertAt) + STORAGE_SHIM + html.slice(insertAt);
  } else {
    html = STORAGE_SHIM + html;
  }
  const h = new Headers(inner.headers);
  for (const [k, v] of Object.entries(EXTENSION_HEADERS)) h.set(k, v);
  h.set("content-type", "text/html; charset=utf-8");
  h.delete("content-length");
  return new Response(html, { status: inner.status, headers: h });
}

function placeholderResponse(status: string, id?: string): Response {
  const html = renderPlaceholder(status, id);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...EXTENSION_HEADERS,
    },
  });
}

function renderPlaceholder(status: string, id?: string): string {
  const messages: Record<string, { heading: string; body: string }> = {
    generating: {
      heading: "Generating your extension…",
      body: "An agent is writing and testing the code. This page will reload when it's ready.",
    },
    failed: {
      heading: "This extension failed to generate.",
      body: "The agent couldn't produce a working build. Try prompting a new one.",
    },
    rejected: {
      heading: "This prompt was rejected.",
      body: "The gatekeeper flagged it as unsafe or off-topic for the vinyl app.",
    },
    pending: {
      heading: "Queued…",
      body: "This extension is waiting to be generated.",
    },
  };
  const m = messages[status] ?? {
    heading: "No extensions yet — soon you'll prompt your own.",
    body: "This URL is reserved for audience-generated views of the vinyl collection.",
  };
  const poller =
    status === "generating" && id
      ? `<script>
        (async () => {
          for (;;) {
            await new Promise((r) => setTimeout(r, 2500));
            try {
              const res = await fetch('/api/v1/extensions/${id}/status', { headers: { accept: 'application/json' } });
              const j = await res.json();
              if (j.status && j.status !== 'generating') { location.reload(); return; }
            } catch {}
          }
        })();
      </script>`
      : "";
  return PLACEHOLDER_HEAD + m.heading + PLACEHOLDER_MID + m.body + PLACEHOLDER_TAIL + poller + PLACEHOLDER_END;
}

// Layer the sandbox headers onto a response from a Dynamic Worker. Used by
// Phase 2; exported so the seam is obvious.
export function layerHeaders(inner: Response): Response {
  const h = new Headers(inner.headers);
  for (const [k, v] of Object.entries(EXTENSION_HEADERS)) {
    h.set(k, v);
  }
  return new Response(inner.body, {
    status: inner.status,
    statusText: inner.statusText,
    headers: h,
  });
}

const PLACEHOLDER_HEAD = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Extension</title>
  <style>
    :root { color-scheme: dark; }
    html, body { margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background:
        radial-gradient(1200px 600px at 20% -10%, rgba(120,90,255,0.18), transparent 60%),
        radial-gradient(900px 500px at 110% 110%, rgba(255,120,180,0.15), transparent 60%),
        #0b0b10;
      color: #e9e9f1;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      padding: 32px;
    }
    main {
      max-width: 560px;
      text-align: center;
      background: rgba(20,20,28,0.6);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px;
      padding: 40px 32px;
      backdrop-filter: blur(8px);
    }
    .badge {
      display: inline-block;
      font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
      padding: 4px 10px; border-radius: 999px;
      background: rgba(120,90,255,0.18);
      color: #b6a6ff;
      margin-bottom: 16px;
    }
    h1 { font-size: 22px; margin: 0 0 12px; font-weight: 600; }
    p  { margin: 0; color: #a8a8b8; line-height: 1.5; }
    a {
      display: inline-block; margin-top: 24px;
      color: #b6a6ff; text-decoration: none; font-weight: 500;
      border-bottom: 1px solid rgba(182,166,255,0.4);
      padding-bottom: 2px;
    }
  </style>
</head>
<body>
  <main>
    <span class="badge">Extension</span>
    <h1>`;

const PLACEHOLDER_MID = `</h1>
    <p>`;

const PLACEHOLDER_TAIL = `</p>
    <a href="/submit">Prompt one →</a>
  </main>`;

const PLACEHOLDER_END = `
</body>
</html>
`;
