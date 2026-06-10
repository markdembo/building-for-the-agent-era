// Abstraction over the Cloudflare Artifacts binding.
//
// The ARTIFACTS binding only creates/manages repos and mints tokens — it
// CANNOT read or write files. File commit/read/log is done with isomorphic-git
// over the repo `remote` + a scoped token, using an in-memory filesystem.
// Reference: https://developers.cloudflare.com/artifacts/examples/isomorphic-git/

import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { MemoryFS } from "./memory-fs";
import type { Env } from "./types";

const DIR = "/workspace";

function stripExpires(token: string): string {
  return token.split("?expires=")[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The git remote URL is deterministic. The `get()` RPC stub exposes methods
// (createToken) but NOT data properties (remote), so we build it ourselves.
function buildRemote(env: Env, name: string): string {
  return `${env.ARTIFACTS_BASE}/${name}.git`;
}

// Get the git remote URL + a Basic-auth token secret for an existing repo.
// Retries on NOT_FOUND to absorb read-after-write lag.
async function getRepoAccess(
  env: Env,
  name: string,
  scope: "read" | "write",
  retries = 6
): Promise<{ remote: string; tokenSecret: string }> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const handle = await env.ARTIFACTS.get(name);
      const { plaintext } = await handle.createToken(scope);
      return { remote: buildRemote(env, name), tokenSecret: stripExpires(plaintext) };
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string } | null)?.code;
      if (code && code !== "NOT_FOUND") throw err;
      await sleep(500);
    }
  }
  throw lastErr;
}

// Returns access for a commit, creating the repo if it does not exist yet.
async function ensureRepoForWrite(
  env: Env,
  name: string
): Promise<{ remote: string; tokenSecret: string; existed: boolean }> {
  try {
    const created = await env.ARTIFACTS.create(name);
    return {
      remote: created.remote ?? buildRemote(env, name),
      tokenSecret: stripExpires(created.token),
      existed: false,
    };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "ALREADY_EXISTS") throw err;
    const access = await getRepoAccess(env, name, "write");
    return { ...access, existed: true };
  }
}

export interface CommitResult {
  artifact_ref: string;
  commit_sha: string;
  commit_message: string;
}

export interface ArtifactsClient {
  commitAndPush(opts: {
    repoName: string;
    files: Record<string, string>;
    message: string;
  }): Promise<CommitResult>;
  readFile(repoName: string, ref: string, path: string): Promise<string>;
  listCommits(
    repoName: string
  ): Promise<Array<{ sha: string; message: string; author: string; timestamp: number }>>;
}

export function getArtifacts(env: Env): ArtifactsClient {
  return new BindingArtifacts(env);
}

class BindingArtifacts implements ArtifactsClient {
  constructor(private env: Env) {}

  async commitAndPush(opts: {
    repoName: string;
    files: Record<string, string>;
    message: string;
  }): Promise<CommitResult> {
    const { remote, tokenSecret, existed } = await ensureRepoForWrite(
      this.env,
      opts.repoName
    );
    const fs = new MemoryFS();
    const onAuth = () => ({ username: "x", password: tokenSecret });

    if (existed) {
      try {
        await git.clone({
          fs,
          http,
          dir: DIR,
          url: remote,
          ref: "main",
          singleBranch: true,
          depth: 1,
          onAuth,
        });
      } catch {
        // Repo exists but is empty (no commits yet) — fall back to init.
        await git.init({ fs, dir: DIR, defaultBranch: "main" });
      }
    } else {
      await git.init({ fs, dir: DIR, defaultBranch: "main" });
    }

    for (const [path, content] of Object.entries(opts.files)) {
      await fs.promises.writeFile(`${DIR}/${path}`, content);
      await git.add({ fs, dir: DIR, filepath: path });
    }

    const commit_sha = await git.commit({
      fs,
      dir: DIR,
      message: opts.message,
      author: { name: "extension-generator", email: "agent@vinyl.app" },
    });

    await git.push({
      fs,
      http,
      dir: DIR,
      url: remote,
      ref: "main",
      onAuth,
    });

    return {
      artifact_ref: opts.repoName,
      commit_sha,
      commit_message: opts.message,
    };
  }

  async readFile(repoName: string, _ref: string, path: string): Promise<string> {
    const { remote, tokenSecret } = await getRepoAccess(this.env, repoName, "read");
    const fs = new MemoryFS();
    await git.clone({
      fs,
      http,
      dir: DIR,
      url: remote,
      ref: "main",
      singleBranch: true,
      depth: 1,
      onAuth: () => ({ username: "x", password: tokenSecret }),
    });
    return (await fs.promises.readFile(`${DIR}/${path}`, "utf8")) as string;
  }

  async listCommits(
    repoName: string
  ): Promise<Array<{ sha: string; message: string; author: string; timestamp: number }>> {
    const { remote, tokenSecret } = await getRepoAccess(this.env, repoName, "read");
    const fs = new MemoryFS();
    await git.clone({
      fs,
      http,
      dir: DIR,
      url: remote,
      ref: "main",
      singleBranch: true,
      depth: 20,
      onAuth: () => ({ username: "x", password: tokenSecret }),
    });
    const commits = await git.log({ fs, dir: DIR, ref: "main", depth: 20 });
    return commits.map((c: { oid: string; commit: { message: string; author?: { name?: string; timestamp?: number } } }) => ({
      sha: c.oid,
      message: c.commit.message,
      author: c.commit.author?.name ?? "unknown",
      timestamp: (c.commit.author?.timestamp ?? 0) * 1000,
    }));
  }
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "ext"
  );
}
