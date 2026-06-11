// POST /api/v1/extensions/submit — the real Phase 2 pipeline:
// validate → classify (gatekeeper) → reject or register + kick off the agent.

import { generateObject, generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { getAgentByName } from "agents";
import { z } from "zod";
import CLASSIFIER_SYSTEM_PROMPT from "../prompts/extension-classifier.md";
import type { GenerationAgent } from "./agent";
import type { Env, ClassifierResult } from "./types";
import {
  insertExtension,
  insertSubmission,
  updateSubmission,
} from "./db";

const CLASSIFIER_MODEL = "@cf/zai-org/glm-4.7-flash";

const ClassifierSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().max(280),
  title: z.string().min(2).max(60),
  category: z.enum(["visual", "feature", "redesign", "other"]),
  risk_flags: z.array(z.string()),
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// Short URL-safe id (nanoid-style, length 10).
function shortId(len = 10): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function classify(
  env: Env,
  prompt: string
): Promise<ClassifierResult> {
  const workersai = createWorkersAI({ binding: env.AI });
  try {
    const { object } = await generateObject({
      model: workersai(CLASSIFIER_MODEL),
      schema: ClassifierSchema,
      system: CLASSIFIER_SYSTEM_PROMPT,
      prompt,
    });
    return object as ClassifierResult;
  } catch {
    // Fallback: ask for JSON text and parse it ourselves. Do NOT switch
    // providers — same model, different call shape.
    const { text } = await generateText({
      model: workersai(CLASSIFIER_MODEL),
      system:
        CLASSIFIER_SYSTEM_PROMPT +
        '\n\nReturn ONLY valid JSON, no prose, matching: {"allowed":boolean,"reason":string,"title":string,"category":"visual"|"feature"|"redesign"|"other","risk_flags":string[]}',
      prompt,
    });
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("no JSON in classifier output");
    return ClassifierSchema.parse(JSON.parse(text.slice(start, end + 1)));
  }
}

export async function handleSubmit(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", allow: "POST" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const promptRaw = (body as { prompt?: unknown })?.prompt;
  if (typeof promptRaw !== "string" || promptRaw.trim().length === 0) {
    return json({ error: "invalid_prompt" }, 400);
  }
  const prompt = promptRaw.trim();
  if (prompt.length > 2000) {
    return json({ error: "prompt_too_long" }, 400);
  }

  const now = new Date().toISOString();
  const submissionId = shortId();
  await insertSubmission(env, {
    id: submissionId,
    prompt,
    status: "received",
    created_at: now,
  });

  // Classify (gatekeeper). Never skip the gate; surface 503 on failure.
  let classifier: ClassifierResult;
  try {
    classifier = await classify(env, prompt);
  } catch {
    try {
      classifier = await classify(env, prompt);
    } catch (err) {
      console.error("classifier unavailable", err);
      await updateSubmission(env, submissionId, {
        status: "error",
        reason: "classifier_unavailable",
      });
      return json(
        {
          error: "classifier_unavailable",
          message:
            "The safety classifier is temporarily unavailable. Please try again.",
        },
        503
      );
    }
  }

  const ts = new Date().toISOString();

  if (!classifier.allowed) {
    const extensionId = shortId();
    await updateSubmission(env, submissionId, {
      status: "rejected",
      reason: classifier.reason,
    });
    await insertExtension(env, {
      id: extensionId,
      title: classifier.title,
      prompt,
      status: "rejected",
      category: classifier.category,
      reason: classifier.reason,
      created_at: ts,
      updated_at: ts,
    });
    return json({
      submission_id: submissionId,
      status: "rejected",
      reason: classifier.reason,
      title: classifier.title,
    });
  }

  // Allowed → register the extension and kick off the agent.
  const extensionId = shortId();
  await insertExtension(env, {
    id: extensionId,
    title: classifier.title,
    prompt,
    status: "generating",
    category: classifier.category,
    reason: null,
    created_at: ts,
    updated_at: ts,
  });
  await updateSubmission(env, submissionId, {
    status: "allowed",
    extension_id: extensionId,
  });

  const agent = await getAgentByName<Env, GenerationAgent>(
    env.GENERATION_AGENT as unknown as DurableObjectNamespace<GenerationAgent>,
    extensionId
  );
  await agent.startGeneration({
    extensionId,
    prompt,
    title: classifier.title,
    classifier,
  });

  return json({
    submission_id: submissionId,
    extension_id: extensionId,
    status: "generating",
    title: classifier.title,
  });
}
