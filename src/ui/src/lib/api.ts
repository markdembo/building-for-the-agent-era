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

export type Submission = {
  id: string;
  prompt: string;
  extension_id: string | null;
  status: string;
  reason: string | null;
  created_at: string;
};

export type Commit = {
  sha: string;
  message: string;
  author: string;
  timestamp: number;
};

export type StatusResponse = {
  id: string;
  status: Extension["status"];
  reason: string | null;
  title?: string;
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
  listExtensions: (all?: boolean) =>
    getJson<{ extensions: Extension[] }>(
      `/api/v1/extensions${all ? "?all=1" : ""}`
    ),
  getExtension: (id: string) =>
    getJson<{ extension: Extension }>(`/api/v1/extensions/${id}`),
  getStatus: (id: string) =>
    getJson<StatusResponse>(`/api/v1/extensions/${id}/status`),
  getSubmission: (id: string) =>
    getJson<{ submission: Submission }>(`/api/v1/submissions/${id}`),
  listExtensionSubmissions: (id: string) =>
    getJson<{ submissions: Submission[] }>(
      `/api/v1/extensions/${id}/submissions`
    ),
  listPendingExtensions: () =>
    getJson<{ ids: string[] }>(`/api/v1/extensions/pending`),
  getCode: (id: string) =>
    getJson<{ html: string; sha: string }>(`/api/v1/extensions/${id}/code`),
  getCommits: (id: string) =>
    getJson<{ commits: Commit[] }>(`/api/v1/extensions/${id}/commits`),
  listSubmissions: () =>
    getJson<{ submissions: Submission[] }>(`/api/v1/submissions`),
  submitPrompt: async (prompt: string, extensionId?: string) => {
    const r = await fetch(`/api/v1/extensions/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(extensionId ? { prompt, extensionId } : { prompt }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      submission_id?: string;
      extension_id?: string;
      status?: string;
      title?: string;
      reason?: string;
      iteration?: boolean;
    };
    return { status: r.status, body };
  },
};
