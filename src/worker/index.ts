import { handleApi } from "./api";
import { handleSubmit } from "./submit";
import { handleExtensionRoute } from "./extensions";
import type { Env } from "./types";

export { GenerationAgent } from "./agent";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // /x/:extensionId — extension loader route.
    if (path.startsWith("/x/")) {
      const id = path.slice(3).split("/")[0];
      if (!id) return new Response("missing extension id", { status: 400 });
      try {
        return await handleExtensionRoute(request, env, id);
      } catch (err) {
        console.error("extension route error", err);
        return new Response("extension error", { status: 500 });
      }
    }

    // /api/v1/extensions/submit — POST stub
    if (path === "/api/v1/extensions/submit") {
      return handleSubmit(request, env);
    }

    // /api/v1/* — read-only data API
    if (path.startsWith("/api/v1/")) {
      const apiResp = await handleApi(request, env, url);
      if (apiResp) return apiResp;
      return new Response(
        JSON.stringify({ error: "not_found" }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }

    // Health probe (handy for smoke tests).
    if (path === "/_health") {
      return new Response("ok", { status: 200 });
    }

    // Everything else — defer to Static Assets (the React UI / SPA fallback).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
