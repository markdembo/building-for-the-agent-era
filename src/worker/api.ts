import {
  rowToExtension,
  rowToRecord,
  type Env,
} from "./types";
import {
  getExtension,
  getRecord,
  listRecords,
  listVisibleExtensions,
  listAllExtensions,
  listSubmissions,
} from "./db";
import { getArtifacts } from "./artifacts";

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      // Public read-only API. CORS-open so the admin preview iframe — which is
      // sandboxed (`allow-scripts`, no `allow-same-origin`) and therefore has a
      // null/opaque origin — can still fetch `/api/v1/*`.
      "access-control-allow-origin": "*",
      ...(init?.headers ?? {}),
    },
  });

export async function handleApi(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  const path = url.pathname;

  // GET /api/v1/records
  if (path === "/api/v1/records" && request.method === "GET") {
    const genre = url.searchParams.get("genre") ?? undefined;
    const style = url.searchParams.get("style") ?? undefined;
    const q = url.searchParams.get("q") ?? undefined;
    const rows = await listRecords(env, { genre, style, q });
    return json({ records: rows.map(rowToRecord) });
  }

  // GET /api/v1/records/:id
  const recMatch = path.match(/^\/api\/v1\/records\/(\d+)$/);
  if (recMatch && request.method === "GET") {
    const id = Number(recMatch[1]);
    const row = await getRecord(env, id);
    if (!row) return json({ error: "not_found" }, { status: 404 });
    return json({ record: rowToRecord(row) });
  }

  // GET /api/v1/extensions  (?all=1 includes rejected — admin)
  if (path === "/api/v1/extensions" && request.method === "GET") {
    const all = url.searchParams.get("all") === "1";
    const rows = all
      ? await listAllExtensions(env)
      : await listVisibleExtensions(env);
    return json({ extensions: rows.map(rowToExtension) });
  }

  // GET /api/v1/submissions (admin)
  if (path === "/api/v1/submissions" && request.method === "GET") {
    const rows = await listSubmissions(env);
    return json({ submissions: rows });
  }

  // GET /api/v1/extensions/:id/status
  const statusMatch = path.match(/^\/api\/v1\/extensions\/([^/]+)\/status$/);
  if (statusMatch && request.method === "GET") {
    const id = statusMatch[1];
    const row = await getExtension(env, id);
    if (!row) return json({ error: "not_found" }, { status: 404 });
    return json({
      id: row.id,
      status: row.status,
      reason: row.reason,
      title: row.title,
      extension_id: row.id,
    });
  }

  // GET /api/v1/extensions/:id/code → { html, sha }
  const codeMatch = path.match(/^\/api\/v1\/extensions\/([^/]+)\/code$/);
  if (codeMatch && request.method === "GET") {
    const id = codeMatch[1];
    const row = await getExtension(env, id);
    if (!row || !row.artifact_ref || !row.last_commit_sha) {
      return json({ error: "not_found" }, { status: 404 });
    }
    try {
      const artifacts = getArtifacts(env);
      const html = await artifacts.readFile(
        row.artifact_ref,
        row.last_commit_sha,
        "index.js"
      );
      return json({ html, sha: row.last_commit_sha });
    } catch (err) {
      return json(
        { error: "read_failed", message: String((err as Error)?.message ?? err) },
        { status: 502 }
      );
    }
  }

  // GET /api/v1/extensions/:id/commits → { commits: [...] }
  const commitsMatch = path.match(/^\/api\/v1\/extensions\/([^/]+)\/commits$/);
  if (commitsMatch && request.method === "GET") {
    const id = commitsMatch[1];
    const row = await getExtension(env, id);
    if (!row || !row.artifact_ref) {
      return json({ error: "not_found" }, { status: 404 });
    }
    try {
      const artifacts = getArtifacts(env);
      const commits = await artifacts.listCommits(row.artifact_ref);
      return json({ commits });
    } catch (err) {
      return json(
        { error: "log_failed", message: String((err as Error)?.message ?? err) },
        { status: 502 }
      );
    }
  }

  // GET /api/v1/extensions/:id
  const extMatch = path.match(/^\/api\/v1\/extensions\/([^/]+)$/);
  if (extMatch && request.method === "GET") {
    const id = extMatch[1];
    const row = await getExtension(env, id);
    if (!row) return json({ error: "not_found" }, { status: 404 });
    return json({ extension: rowToExtension(row) });
  }

  return null;
}
