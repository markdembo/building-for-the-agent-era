// Thin abstraction over the Cloudflare Artifacts binding.
// Phase 1 only needs `readFile` (called from the /x/:id loader path).
// Phase 2 fills in `createRepo`, `commitFiles`, `listCommits` for the agent.
//
// The Artifacts product is in closed beta. The binding shape is documented at
// https://developers.cloudflare.com/artifacts/api/workers-binding/.
// All methods return rejected promises in Phase 1 — Phase 2 implements them.

import type { Env } from "./types";

export interface ArtifactsClient {
  createRepo(name: string): Promise<{ name: string; remote: string; token: string }>;
  commitFiles(
    repoName: string,
    files: Record<string, string>,
    message: string
  ): Promise<{ commit_sha: string }>;
  listCommits(repoName: string): Promise<Array<{ sha: string; message: string; date: string }>>;
  readFile(repoName: string, sha: string, path: string): Promise<string>;
}

export function getArtifacts(env: Env): ArtifactsClient {
  return new BindingArtifacts(env);
}

class BindingArtifacts implements ArtifactsClient {
  constructor(private env: Env) {}

  async createRepo(name: string) {
    const api = this.env.ARTIFACTS as {
      create(name: string): Promise<{ name: string; remote: string; token: string }>;
    };
    return api.create(name);
  }

  async commitFiles(): Promise<{ commit_sha: string }> {
    // Phase 2 will implement commit-via-Git using the remote + token from
    // createRepo() and a standard Git client (or isomorphic-git).
    throw new Error("not_implemented: commitFiles is Phase 2");
  }

  async listCommits(): Promise<Array<{ sha: string; message: string; date: string }>> {
    throw new Error("not_implemented: listCommits is Phase 2");
  }

  async readFile(): Promise<string> {
    // Phase 2 will implement readFile via the REST API or by issuing a
    // ref-scoped Git fetch. Phase 1 never calls this on the hot path.
    throw new Error("not_implemented: readFile is Phase 2");
  }
}
