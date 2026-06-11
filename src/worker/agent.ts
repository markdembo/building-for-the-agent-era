// The generation agent. Runs the tool-use loop inside an Agents SDK Agent
// (a Durable Object) so it survives past the originating request — generation
// is multi-minute and `ctx.waitUntil` would be cancelled. Kicked off from
// POST /submit via getAgentByName + startGeneration (plain DO RPC).
//
// The generator model is `anthropic/claude-opus-4.8` reached via raw
// `env.AI.run` (Anthropic Messages API shape). workers-ai-provider does not
// speak the Anthropic-native request/response, so the tool-use loop is driven
// by hand here: call → read tool_use blocks → execute → feed tool_result back.

import { Agent } from "agents";
import GENERATOR_SYSTEM_PROMPT from "../prompts/extension-generator.md";
import type { Env, GenerationJob } from "./types";
import { getExtension, updateExtension, updateSubmission } from "./db";
import { getArtifacts, slugify } from "./artifacts";

const GENERATOR_MODEL = "anthropic/claude-opus-4.8";
const MAX_STEPS = 8;
const MAX_TEST_CALLS = 4;

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  [k: string]: unknown;
}
interface AnthropicResponse {
  content: AnthropicBlock[];
  stop_reason: string | null;
}
type AiRunner = { run(model: string, body: unknown): Promise<AnthropicResponse> };

const TOOLS = [
  {
    name: "test_code",
    description:
      "Load the candidate Worker module as a Dynamic Worker and validate it. Returns { ok, status, errors, html }.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Full ES module source for index.js" },
      },
      required: ["code"],
    },
  },
  {
    name: "commit_and_push_code",
    description:
      "Commit the validated module to the extension's Artifacts repo and push. Call once test_code returns ok:true.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Final ES module source for index.js" },
        readme: { type: "string", description: "Human-readable README for the repo" },
      },
      required: ["code"],
    },
  },
];

export interface TestCodeResult {
  ok: boolean;
  status: number;
  html: string;
  logs: string[];
  errors: string[];
}

// Load a candidate Worker module as a Dynamic Worker and validate it. The
// loader posture (globalOutbound: null, no bindings) IS the sandbox.
export async function testCode(env: Env, code: string): Promise<TestCodeResult> {
  const errors: string[] = [];
  const logs: string[] = [];
  try {
    const worker = env.LOADER.load({
      compatibilityDate: env.LOADER_COMPAT_DATE,
      mainModule: "index.js",
      modules: { "index.js": code },
      globalOutbound: null, // FROZEN — no outbound network
      // no `bindings`: the isolate has no D1 / AI / Artifacts / KV
    });
    const res = await worker
      .getEntrypoint()
      .fetch(new Request("https://test.local/", { method: "GET" }), {
        signal: AbortSignal.timeout(5000),
      });
    const html = (await res.text()).slice(0, 64 * 1024);
    const ok = res.status === 200 && html.trim().length > 0 && errors.length === 0;
    return { ok, status: res.status, html, logs, errors };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name === "TimeoutError") errors.push("timeout");
    else errors.push(String(err?.message ?? e));
    return { ok: false, status: 0, html: "", logs, errors };
  }
}

export async function commitAndPush(
  env: Env,
  input: {
    extensionId: string;
    title: string;
    code: string;
    readme: string;
    promptJson: unknown;
    message: string;
  }
): Promise<{ artifact_ref: string; commit_sha: string; commit_message: string }> {
  const repoName = `ext-${input.extensionId}-${slugify(input.title)}`;
  const artifacts = getArtifacts(env);
  return artifacts.commitAndPush({
    repoName,
    message: input.message,
    files: {
      "index.js": input.code,
      "README.md": input.readme,
      "prompt.json": JSON.stringify(input.promptJson, null, 2),
    },
  });
}

export class GenerationAgent extends Agent<Env> {
  // Worker→Agent RPC (no @callable needed). Schedules and returns fast.
  async startGeneration(job: GenerationJob): Promise<void> {
    await this.schedule(0, "runGeneration", job);
  }

  async runGeneration(job: GenerationJob): Promise<void> {
    const { extensionId, prompt, title, classifier, submissionId } = job;
    const isIteration = job.isIteration === true;
    const ai = this.env.AI as unknown as AiRunner;
    let testCalls = 0;
    let committed = false;
    let lastErrors: string[] = [];
    let diag = "";

    const promptJson = {
      extension_id: extensionId,
      title,
      prompt,
      classifier,
      iteration: isIteration,
      created_at: new Date().toISOString(),
    };

    // When iterating, load the current shipped source so the model edits the
    // real thing instead of regenerating from scratch.
    let baseCode = "";
    if (isIteration) {
      try {
        const row = await getExtension(this.env, extensionId);
        if (row?.artifact_ref && row.last_commit_sha) {
          baseCode = await getArtifacts(this.env).readFile(
            row.artifact_ref,
            row.last_commit_sha,
            "index.js"
          );
        }
      } catch (e) {
        console.error("[agent] failed to load base code", {
          extensionId,
          message: (e as Error)?.message,
        });
      }
    }

    const initialContent =
      isIteration && baseCode
        ? `You are ITERATING on an existing, already-shipped extension. The same hard rules apply (fully stateless, data only via same-origin /api/v1/*, no imports/build step, no external network, responsive/mobile-first). Preserve everything that already works and apply ONLY the requested change.\n\nExtension title: ${title}\n\nThis is the current live index.js:\n\n\`\`\`js\n${baseCode}\n\`\`\`\n\nRequested change:\n${prompt}\n\nReturn the COMPLETE updated index.js, validate it with test_code, then commit_and_push_code once test_code returns ok:true.`
        : `Prompt: ${prompt}\nTitle: ${title}`;

    const messages: Array<{ role: string; content: unknown }> = [
      { role: "user", content: initialContent },
    ];

    try {
      for (let step = 1; step <= MAX_STEPS; step++) {
        const res = await ai.run(GENERATOR_MODEL, {
          max_tokens: 16000,
          system: GENERATOR_SYSTEM_PROMPT,
          messages,
          tools: TOOLS,
        });
        const content = res.content ?? [];
        messages.push({ role: "assistant", content });

        if (res.stop_reason !== "tool_use") {
          const text = content
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join(" ")
            .slice(0, 120);
          diag = `stop=${res.stop_reason} step=${step} testCalls=${testCalls} text="${text}"`;
          break;
        }

        const toolUses = content.filter((b) => b.type === "tool_use");
        const toolResults: AnthropicBlock[] = [];
        for (const tu of toolUses) {
          const input = (tu.input ?? {}) as { code?: string; readme?: string };
          let result: unknown;
          if (tu.name === "test_code") {
            if (testCalls >= MAX_TEST_CALLS) {
              result = {
                ok: false,
                errors: ["iteration budget exceeded — commit your best attempt"],
              };
            } else {
              testCalls++;
              const r = await testCode(this.env, input.code ?? "");
              lastErrors = r.errors;
              console.log("[agent] test_code", {
                extensionId,
                call: testCalls,
                ok: r.ok,
                status: r.status,
                errors: r.errors,
              });
              result = {
                ok: r.ok,
                status: r.status,
                errors: r.errors,
                html: r.html.slice(0, 1500),
              };
            }
          } else if (tu.name === "commit_and_push_code") {
            const code = input.code ?? "";
            const readme =
              input.readme && input.readme.trim().length > 0
                ? input.readme
                : defaultReadme(title, prompt, classifier);
            const r = await commitAndPush(this.env, {
              extensionId,
              title,
              code,
              readme,
              promptJson,
              message: isIteration ? `iterate: ${title}` : `feat: ${title}`,
            });
            // The extension now points at the new commit. This is identical for
            // a first build and an iteration — the live version is the latest
            // successful commit.
            await updateExtension(this.env, extensionId, {
              status: "ready",
              reason: null,
              artifact_ref: r.artifact_ref,
              last_commit_sha: r.commit_sha,
              last_commit_message: r.commit_message,
            });
            committed = true;
            console.log("[agent] committed", { extensionId, ...r });
            result = r;
          } else {
            result = { error: `unknown tool ${tu.name}` };
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          });
        }

        messages.push({ role: "user", content: toolResults });
        if (committed) {
          diag = `committed step=${step}`;
          break;
        }
      }
    } catch (e) {
      const err = e as Error;
      console.error("[agent] loop threw", {
        extensionId,
        name: err?.name,
        message: err?.message,
        stack: err?.stack?.slice(0, 800),
      });
      diag = `threw ${err?.name ?? ""}: ${err?.message ?? JSON.stringify(e)}`;
    }

    const failureReason = (
      "no commit | " + diag + " | lastErrors=" + lastErrors.slice(0, 2).join("; ")
    ).slice(0, 280);

    if (committed) {
      // Mark the originating submission as the successful outcome (powers the
      // per-extension iteration history with its check mark).
      if (submissionId) {
        await updateSubmission(this.env, submissionId, {
          status: "ready",
          reason: null,
        });
      }
    } else {
      if (submissionId) {
        await updateSubmission(this.env, submissionId, {
          status: "failed",
          reason: failureReason,
        });
      }
      // A failed ITERATION must never take down the live extension — it keeps
      // pointing at the last successful commit. Only fail the extension row on
      // an initial build that never produced a working commit.
      if (!isIteration) {
        await updateExtension(this.env, extensionId, {
          status: "failed",
          reason: failureReason,
        });
      }
    }
  }
}

function defaultReadme(
  title: string,
  prompt: string,
  classifier: GenerationJob["classifier"]
): string {
  return `# ${title}

Generated vinyl-app extension.

## Prompt

${prompt}

## Classifier

- allowed: ${classifier.allowed}
- category: ${classifier.category}
- reason: ${classifier.reason}
- risk_flags: ${classifier.risk_flags.join(", ") || "none"}
`;
}
