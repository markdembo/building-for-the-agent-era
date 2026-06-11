// Shared types. The `Record` shape is FROZEN — extensions depend on it.

export type RecordDTO = {
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

export type ExtensionDTO = {
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

// D1 row shape (snake_case).
export type RecordRow = {
  id: number;
  artist: string;
  title: string;
  year: number | null;
  genres: string; // JSON
  styles: string; // JSON
  format: string | null;
  vinyl_color: string | null;
  cover_image: string;
  thumbnail: string;
  discogs_url: string | null;
  rating: number | null;
  date_added: string;
};

export type ExtensionRow = {
  id: string;
  title: string;
  prompt: string;
  status: ExtensionDTO["status"];
  category: ExtensionDTO["category"];
  reason: string | null;
  artifact_ref: string | null;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  created_at: string;
  updated_at: string;
};

export type SubmissionRow = {
  id: string;
  prompt: string;
  extension_id: string | null;
  status: string;
  reason: string | null;
  created_at: string;
};

export type ClassifierResult = {
  allowed: boolean;
  reason: string;
  title: string;
  category: "visual" | "feature" | "redesign" | "other";
  risk_flags: string[];
};

export type GenerationJob = {
  extensionId: string;
  prompt: string;
  title: string;
  classifier: ClassifierResult;
};

// The Cloudflare Artifacts binding: repo lifecycle + token minting only. It
// cannot read or write files — that is done with isomorphic-git over `remote`.
export interface ArtifactsRepoHandle {
  remote?: string;
  createToken(
    scope?: "read" | "write",
    ttl?: number
  ): Promise<{ plaintext: string; expiresAt?: number }>;
}
export interface ArtifactsBinding {
  create(
    name: string,
    opts?: unknown
  ): Promise<{ name: string; remote: string; defaultBranch?: string; token: string }>;
  get(name: string): Promise<ArtifactsRepoHandle>;
  delete(name: string): Promise<unknown>;
  list(opts?: unknown): Promise<unknown>;
}

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  AI: Ai;
  ARTIFACTS: ArtifactsBinding;
  LOADER: WorkerLoader;
  GENERATION_AGENT: DurableObjectNamespace;
  APP_ORIGIN: string;
  LOADER_COMPAT_DATE: string;
}

// Worker Loader API surface (Dynamic Workers). Typed minimally so we can call
// it without depending on yet-unpublished types. See
// https://developers.cloudflare.com/dynamic-workers/api-reference/
export interface WorkerLoader {
  load(code: WorkerCode): WorkerStub;
  get(id: string, cb: () => Promise<WorkerCode> | WorkerCode): WorkerStub;
}

export interface WorkerCode {
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  mainModule: string;
  modules: Record<string, string>;
  globalOutbound: null | unknown;
  bindings?: Record<string, unknown>;
}

export interface WorkerStub {
  getEntrypoint(name?: string): {
    fetch(req: Request, init?: RequestInit): Promise<Response>;
  };
}

export function rowToRecord(r: RecordRow): RecordDTO {
  return {
    id: r.id,
    artist: r.artist,
    title: r.title,
    year: r.year,
    genres: safeJsonArray(r.genres),
    styles: safeJsonArray(r.styles),
    format: r.format,
    vinylColor: r.vinyl_color,
    coverImage: r.cover_image,
    thumbnail: r.thumbnail,
    discogsUrl: r.discogs_url,
    rating: r.rating,
    dateAdded: r.date_added,
  };
}

export function rowToExtension(r: ExtensionRow): ExtensionDTO {
  return {
    id: r.id,
    title: r.title,
    prompt: r.prompt,
    status: r.status,
    category: r.category,
    reason: r.reason,
    artifact_ref: r.artifact_ref,
    last_commit_sha: r.last_commit_sha,
    last_commit_message: r.last_commit_message,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
