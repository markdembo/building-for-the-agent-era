import type { Env, RecordRow, ExtensionRow } from "./types";

export async function listRecords(
  env: Env,
  opts: { genre?: string; style?: string; q?: string }
): Promise<RecordRow[]> {
  // Pull everything; filter in JS. 75 rows is trivial and lets us match
  // case-insensitively against JSON arrays without a JSON1 dependency.
  const { results } = await env.DB.prepare(
    "SELECT * FROM records ORDER BY date_added DESC"
  ).all<RecordRow>();

  let rows = results ?? [];

  if (opts.genre) {
    const g = opts.genre.toLowerCase();
    rows = rows.filter((r) =>
      safeArr(r.genres).some((x) => x.toLowerCase().includes(g))
    );
  }
  if (opts.style) {
    const s = opts.style.toLowerCase();
    rows = rows.filter((r) =>
      safeArr(r.styles).some((x) => x.toLowerCase().includes(s))
    );
  }
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.artist.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q)
    );
  }
  return rows;
}

export async function getRecord(env: Env, id: number): Promise<RecordRow | null> {
  const row = await env.DB.prepare("SELECT * FROM records WHERE id = ?")
    .bind(id)
    .first<RecordRow>();
  return row ?? null;
}

export async function listVisibleExtensions(env: Env): Promise<ExtensionRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM extensions WHERE status IN ('ready','generating','failed') ORDER BY created_at DESC"
  ).all<ExtensionRow>();
  return results ?? [];
}

export async function getExtension(
  env: Env,
  id: string
): Promise<ExtensionRow | null> {
  const row = await env.DB.prepare("SELECT * FROM extensions WHERE id = ?")
    .bind(id)
    .first<ExtensionRow>();
  return row ?? null;
}

function safeArr(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
