// Hidden component that imports CodeHighlighted so Vite includes it in the
// bundle. Phase 2 needs syntax highlighting on day one (admin Code tab) and
// must not have to add the dependency mid-talk.

import { CodeHighlighted, ShikiProvider } from "@cloudflare/kumo/code";

export function CodePreloader() {
  return (
    <div aria-hidden="true" style={{ display: "none" }}>
      <ShikiProvider engine="javascript" languages={["typescript", "javascript", "tsx", "json", "html"]}>
        <CodeHighlighted code={"const ready = true;"} lang="ts" />
      </ShikiProvider>
    </div>
  );
}
