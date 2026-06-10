import type { Env, ExtensionRow } from "./types";
import { getExtension } from "./db";
import { getArtifacts } from "./artifacts";

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

// Phase 1 always returns null. Phase 2 will return the resolved registry row
// (only when status === 'ready'); this function is the seam.
export async function resolveExtension(
  env: Env,
  id: string
): Promise<Pick<ExtensionRow, "status" | "artifact_ref" | "last_commit_sha"> | null> {
  const row = await getExtension(env, id);
  if (!row) return null;
  if (row.status !== "ready") return null;
  return {
    status: row.status,
    artifact_ref: row.artifact_ref,
    last_commit_sha: row.last_commit_sha,
  };
}

// GET /x/:extensionId — always 200 in Phase 1. Returns the placeholder for any
// id. Phase 2 fills in the Dynamic Workers invocation marked below.
export async function handleExtensionRoute(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const ext = await resolveExtension(env, id);

  if (ext && ext.artifact_ref && ext.last_commit_sha) {
    // PHASE_2: load extension source from Artifacts and invoke env.LOADER
    //
    // Phase 2 must replace this block with:
    //
    //   const artifacts = getArtifacts(env);
    //   const code = await artifacts.readFile(
    //     ext.artifact_ref, ext.last_commit_sha, "index.js"
    //   );
    //   const worker = env.LOADER.get(
    //     `${id}@${ext.last_commit_sha}`,
    //     async () => ({
    //       compatibilityDate: env.LOADER_COMPAT_DATE,
    //       mainModule: "index.js",
    //       modules: { "index.js": code },
    //       globalOutbound: null,
    //     })
    //   );
    //   const inner = await worker.getEntrypoint().fetch(request);
    //   return layerHeaders(inner);
    //
    // Both `globalOutbound: null` and the absence of a `bindings` field
    // are FROZEN — never relax them.
    void getArtifacts; // referenced so Phase 2 can lean on the same import
  }

  // Phase 1 placeholder for any id (known, unknown, or pending).
  return placeholderResponse();
}

function placeholderResponse(): Response {
  const html = PLACEHOLDER_HTML;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...EXTENSION_HEADERS,
    },
  });
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

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Extension placeholder</title>
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
    <h1>No extensions yet — soon you'll prompt your own.</h1>
    <p>This URL is reserved for audience-generated views of the vinyl collection. Each one runs in its own sandboxed Worker, talking only to the public API.</p>
    <a href="/submit">Prompt one →</a>
  </main>
</body>
</html>
`;
