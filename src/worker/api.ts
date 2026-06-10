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
} from "./db";

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
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

  // GET /api/v1/extensions
  if (path === "/api/v1/extensions" && request.method === "GET") {
    const rows = await listVisibleExtensions(env);
    return json({ extensions: rows.map(rowToExtension) });
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
      extension_id: row.id,
    });
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
