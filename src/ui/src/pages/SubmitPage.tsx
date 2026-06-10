import { useEffect, useRef, useState } from "react";
import { Button } from "@cloudflare/kumo/components/button";
import { InputArea } from "@cloudflare/kumo/components/input";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Loader } from "@cloudflare/kumo/components/loader";
import { SparkleIcon } from "@phosphor-icons/react";
import { useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { api } from "../lib/api";

type Phase =
  | { kind: "idle" }
  | { kind: "rejected"; title?: string; reason?: string }
  | { kind: "generating"; extensionId: string; title?: string }
  | { kind: "ready"; extensionId: string; title?: string }
  | { kind: "failed"; title?: string; reason?: string }
  | { kind: "error"; message: string };

// Rotating prompt ideas shown as a typewriter placeholder + quick-fill chips.
const IDEAS = [
  "make the album covers spin slowly",
  "turn the collection into a neon arcade grid",
  "a quiz that hides the title and asks for the artist",
  "lay everything out on a vertical timeline by year",
  "tint every cover in vaporwave purple & teal",
  "a 'now playing' view with one giant rotating record",
  "group records by genre into colorful stacks",
];

// Typewriter effect: types a phrase, pauses, deletes, moves to the next.
function useTypewriter(words: string[], active: boolean): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!active) {
      setText("");
      return;
    }
    let word = 0;
    let ch = 0;
    let deleting = false;
    let timer: number;
    const tick = () => {
      const current = words[word % words.length];
      if (!deleting) {
        ch++;
        setText(current.slice(0, ch));
        if (ch >= current.length) {
          deleting = true;
          timer = window.setTimeout(tick, 2000);
          return;
        }
        timer = window.setTimeout(tick, 42 + Math.random() * 45);
      } else {
        ch--;
        setText(current.slice(0, ch));
        if (ch <= 0) {
          deleting = false;
          word++;
          timer = window.setTimeout(tick, 420);
          return;
        }
        timer = window.setTimeout(tick, 22);
      }
    };
    timer = window.setTimeout(tick, 500);
    return () => window.clearTimeout(timer);
  }, [active, words]);
  return text;
}

export default function SubmitPage() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const toast = useKumoToastManager();
  const pollRef = useRef<number | null>(null);

  const locked = busy || phase.kind === "generating";
  const typing = useTypewriter(IDEAS, prompt === "" && !locked);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = (extensionId: string, title?: string) => {
    const started = Date.now();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      if (Date.now() - started > 90_000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setPhase({ kind: "failed", title, reason: "Timed out waiting for generation." });
        return;
      }
      try {
        const s = await api.getStatus(extensionId);
        if (s.status === "ready") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase({ kind: "ready", extensionId, title: s.title ?? title });
          toast.add({ title: "Ready", description: s.title ?? title ?? "", variant: "success" });
        } else if (s.status === "failed" || s.status === "rejected") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase({ kind: "failed", title: s.title ?? title, reason: s.reason ?? "Generation failed." });
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setPhase({ kind: "idle" });
    try {
      const r = await api.submitPrompt(prompt.trim());
      const b = r.body;
      if (r.status === 503) {
        setPhase({ kind: "error", message: b.message ?? "Classifier unavailable. Try again." });
      } else if (r.status >= 400) {
        setPhase({ kind: "error", message: b.error ?? "Submission failed." });
      } else if (b.status === "rejected") {
        setPhase({ kind: "rejected", title: b.title, reason: b.reason });
      } else if (b.status === "generating" && b.extension_id) {
        setPhase({ kind: "generating", extensionId: b.extension_id, title: b.title });
        startPolling(b.extension_id, b.title);
      } else {
        setPhase({ kind: "error", message: "Unexpected response." });
      }
    } catch (err) {
      setPhase({ kind: "error", message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setPrompt("");
    setPhase({ kind: "idle" });
  };

  return (
    <div className="relative min-h-screen">
      <div className="relative mx-auto max-w-2xl px-4 py-12 sm:py-16">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            What should we build?
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-kumo-subtle sm:text-base">
            Describe a change to this vinyl app. An agent writes, tests, and ships
            it as your own sandboxed view — live, in seconds.
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-4">
          <InputArea
            placeholder={
              prompt === "" && !locked
                ? `${typing}\u258b`
                : "Describe a change to the vinyl app…"
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            maxLength={2000}
            disabled={locked}
            className="min-h-[160px] w-full resize-none text-base"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs tabular-nums text-kumo-subtle">
              {prompt.length} / 2000
            </span>
            <Button
              type="submit"
              variant="primary"
              disabled={locked || !prompt.trim()}
              className="min-h-[44px] gap-1.5 px-6"
            >
              <SparkleIcon size={16} weight="fill" />
              {busy ? "Submitting…" : "Generate"}
            </Button>
          </div>
        </form>

        {/* quick-fill idea chips */}
        {!locked && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-kumo-subtle">Try:</span>
            {IDEAS.slice(0, 4).map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setPrompt(idea)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-kumo-default transition hover:border-fuchsia-400/40 hover:bg-fuchsia-400/10 hover:text-white"
              >
                {idea}
              </button>
            ))}
          </div>
        )}

        <div className="mt-8 space-y-4">
          {phase.kind === "rejected" && (
            <div className="animate-fade-in-up">
              <Banner
                variant="error"
                title={`Rejected${phase.title ? `: ${phase.title}` : ""}`}
                description={phase.reason ?? "This prompt was not allowed."}
              />
            </div>
          )}

          {phase.kind === "generating" && (
            <div className="animate-fade-in-up flex items-center gap-3 rounded-xl border border-violet-400/20 bg-violet-400/5 p-4">
              <Loader />
              <span className="text-sm">
                Generating your extension{phase.title ? `: “${phase.title}”` : ""}…
                <span className="block text-xs text-kumo-subtle">
                  Writing code, testing it in a sandbox, and committing — usually under a minute.
                </span>
              </span>
            </div>
          )}

          {phase.kind === "ready" && (
            <div className="animate-fade-in-up rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-5 text-center">
              <p className="text-sm text-kumo-subtle">Your extension is ready</p>
              <h2 className="mt-1 text-lg font-semibold">{phase.title ?? "extension"}</h2>
              <a
                href={`/x/${phase.extensionId}`}
                className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-violet-600 px-5 text-sm font-medium text-white transition hover:bg-violet-500"
              >
                Open it →
              </a>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-kumo-subtle underline hover:text-white"
                >
                  Build another
                </button>
              </div>
            </div>
          )}

          {phase.kind === "failed" && (
            <div className="animate-fade-in-up space-y-3">
              <Banner
                variant="error"
                title={`Generation failed${phase.title ? `: ${phase.title}` : ""}`}
                description={phase.reason ?? "The agent couldn't produce a working build."}
              />
              <Button variant="secondary" onClick={reset}>
                Try again
              </Button>
            </div>
          )}

          {phase.kind === "error" && (
            <div className="animate-fade-in-up">
              <Banner variant="error" title="Something went wrong" description={phase.message} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
