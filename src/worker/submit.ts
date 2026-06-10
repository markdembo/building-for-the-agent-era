import type { Env } from "./types";

// POST /api/v1/extensions/submit
// Phase 1: validate input, return HTTP 501 with the friendly body.
// Phase 2 will replace this with the real classifier + agent pipeline.
export async function handleSubmit(
  request: Request,
  _env: Env
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
    return new Response(
      JSON.stringify({ error: "invalid_json" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const prompt = (body as { prompt?: unknown })?.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return new Response(
      JSON.stringify({ error: "invalid_prompt" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }
  if (prompt.length > 2000) {
    return new Response(
      JSON.stringify({ error: "prompt_too_long" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      error: "not_implemented",
      message:
        "The platform doesn't exist yet — come to the talk.",
    }),
    {
      status: 501,
      headers: { "content-type": "application/json; charset=utf-8" },
    }
  );
}
