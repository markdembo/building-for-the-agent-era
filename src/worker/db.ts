import type { Env, RecordRow, ExtensionRow, SubmissionRow } from "./types";

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

export async function listAllExtensions(env: Env): Promise<ExtensionRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM extensions ORDER BY created_at DESC"
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

export async function insertSubmission(
  env: Env,
  row: { id: string; prompt: string; status: string; created_at: string }
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO submissions (id, prompt, extension_id, status, reason, created_at) VALUES (?, ?, NULL, ?, NULL, ?)"
  )
    .bind(row.id, row.prompt, row.status, row.created_at)
    .run();
}

export async function updateSubmission(
  env: Env,
  id: string,
  patch: { status?: string; reason?: string | null; extension_id?: string | null }
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.reason !== undefined) {
    sets.push("reason = ?");
    vals.push(patch.reason);
  }
  if (patch.extension_id !== undefined) {
    sets.push("extension_id = ?");
    vals.push(patch.extension_id);
  }
  if (!sets.length) return;
  vals.push(id);
  await env.DB.prepare(`UPDATE submissions SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
}

export async function listSubmissions(env: Env): Promise<SubmissionRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM submissions ORDER BY created_at DESC"
  ).all<SubmissionRow>();
  return results ?? [];
}

export async function insertExtension(
  env: Env,
  row: {
    id: string;
    title: string;
    prompt: string;
    status: string;
    category: string | null;
    reason: string | null;
    created_at: string;
    updated_at: string;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO extensions
       (id, title, prompt, status, category, reason, artifact_ref, last_commit_sha, last_commit_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
  )
    .bind(
      row.id,
      row.title,
      row.prompt,
      row.status,
      row.category,
      row.reason,
      row.created_at,
      row.updated_at
    )
    .run();
}

export async function updateExtension(
  env: Env,
  id: string,
  patch: Partial<{
    status: string;
    reason: string | null;
    artifact_ref: string | null;
    last_commit_sha: string | null;
    last_commit_message: string | null;
  }>
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString());
  vals.push(id);
  await env.DB.prepare(`UPDATE extensions SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
}

function safeArr(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
