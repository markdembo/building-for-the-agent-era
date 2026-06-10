// Typed fetch client for /api/v1/*.

export type Record = {
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
  dateAdded: string;
};

export type Extension = {
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

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  listRecords: (q?: { genre?: string; style?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (q?.genre) sp.set("genre", q.genre);
    if (q?.style) sp.set("style", q.style);
    if (q?.q) sp.set("q", q.q);
    const s = sp.toString();
    return getJson<{ records: Record[] }>(`/api/v1/records${s ? `?${s}` : ""}`);
  },
  getRecord: (id: number) => getJson<{ record: Record }>(`/api/v1/records/${id}`),
  listExtensions: () => getJson<{ extensions: Extension[] }>(`/api/v1/extensions`),
  submitPrompt: async (prompt: string) => {
    const r = await fetch(`/api/v1/extensions/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      submission_id?: string;
      extension_id?: string;
      status?: string;
      title?: string;
      reason?: string;
    };
    return { status: r.status, body };
  },
};
