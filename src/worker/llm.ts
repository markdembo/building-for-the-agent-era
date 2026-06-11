// Structured LLM call helper. Phase 1 throws — Phase 2 fills in the actual
// retry / validate / repair loop. Including this stub means Phase 2 only has
// to think about prompts, not plumbing.
//
// Phase 2 implementation should:
//   - call env.AI.run(...) with JSON mode (response_format json_schema) on the
//     FIXED classifier model "@cf/zai-org/glm-4.7-flash". No provider
//     switching, no Anthropic, no OpenAI-compatible endpoint.
//     (The generator/agent loop uses "@cf/moonshotai/kimi-k2.6".)
//   - validate against `schema`
//   - retry up to `maxRetries` times on parse/validation failure,
//     feeding the validation error back to the model
//   - throw a typed error if all attempts fail

import type { Env } from "./types";

export interface CallLLMJsonOptions {
  env: Env;
  system: string;
  user: string;
  schema: unknown;
  maxRetries?: number;
}

export async function callLLMJson<T>(_opts: CallLLMJsonOptions): Promise<T> {
  throw new Error("not_implemented: callLLMJson is Phase 2");
}
