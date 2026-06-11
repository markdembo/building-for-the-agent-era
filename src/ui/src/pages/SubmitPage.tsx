import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Button } from "@cloudflare/kumo/components/button";
import { InputArea } from "@cloudflare/kumo/components/input";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Loader } from "@cloudflare/kumo/components/loader";
import {
  SparkleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ClockIcon,
} from "@phosphor-icons/react";
import { useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { api, type Extension, type Submission } from "../lib/api";

type Phase =
  | { kind: "idle" }
  | { kind: "rejected"; title?: string; reason?: string }
  | { kind: "generating"; extensionId: string; submissionId?: string; title?: string }
  | { kind: "ready"; extensionId: string; title?: string }
  | { kind: "timedout"; extensionId: string; submissionId?: string; title?: string }
  | { kind: "failed"; title?: string; reason?: string }
  | { kind: "error"; message: string };

// How long to poll before assuming the connection (not the agent) gave up.
// Conference Wi-Fi is spotty, so this is generous and the user can re-check.
const POLL_TIMEOUT_MS = 180_000;

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

// Edit-flavored suggestions shown when iterating on an existing extension.
const EDIT_IDEAS = [
  "make the buttons bigger and rounder",
  "add a dark mode toggle",
  "show the year next to each title",
  "speed up the animation",
  "use a warmer color palette",
  "add a score counter",
];

// Cloudflare-flavored "we're still working" words, rotated while generating.
const WORKING_WORDS = [
  "Spinning up isolates",
  "Warming the edge",
  "Summoning Workers",
  "Propagating to 300+ cities",
  "Sandboxing your code",
  "Conjuring Durable Objects",
  "Routing through the edge",
  "Committing to Artifacts",
  "Caching at the edge",
  "Orange-clouding",
];

// Cycles through words on an interval while `active`. Returns the current word.
function useRotating(words: string[], active: boolean, intervalMs = 1800): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    setI(0);
    const id = window.setInterval(
      () => setI((n) => (n + 1) % words.length),
      intervalMs
    );
    return () => window.clearInterval(id);
  }, [active, words, intervalMs]);
  return words[i];
}

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

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const s = Math.round(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString();
}

// Maps a submission's lifecycle status to a history-row outcome.
function outcomeOf(status: string): "ok" | "fail" | "pending" {
  if (status === "ready") return "ok";
  if (status === "failed" || status === "rejected" || status === "error")
    return "fail";
  return "pending";
}

// A real generation finishes well within this window; an unfinished submission
// older than this is stale (legacy rows) and must not lock the form. Mirrors
// the server-side PENDING_WINDOW_MS.
const PENDING_WINDOW_MS = 5 * 60 * 1000;

// The newest genuinely in-flight submission in a (newest-first) history list.
function findInFlight(list: Submission[]): Submission | undefined {
  return list.find(
    (s) =>
      outcomeOf(s.status) === "pending" &&
      Date.now() - new Date(s.created_at).getTime() < PENDING_WINDOW_MS
  );
}

function HistoryRow({ s }: { s: Submission }) {
  const outcome = outcomeOf(s.status);
  // A "pending" row older than the window isn't actually running (legacy rows
  // the old pipeline never finalized) — show it as neutral, not a live spinner.
  const stale =
    outcome === "pending" &&
    Date.now() - new Date(s.created_at).getTime() >= PENDING_WINDOW_MS;
  return (
    <li className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
      <span className="mt-0.5 shrink-0">
        {outcome === "ok" && (
          <CheckCircleIcon size={20} weight="fill" className="text-emerald-400" />
        )}
        {outcome === "fail" && (
          <XCircleIcon size={20} weight="fill" className="text-rose-400" />
        )}
        {outcome === "pending" &&
          (stale ? (
            <ClockIcon size={20} className="text-kumo-subtle" />
          ) : (
            <Loader size="sm" />
          ))}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-kumo-default" title={s.prompt}>
          {s.prompt}
        </p>
        {outcome === "fail" && s.reason && (
          <p className="mt-0.5 truncate text-xs text-rose-300/80" title={s.reason}>
            {s.reason}
          </p>
        )}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-kumo-subtle">
        {relTime(s.created_at)}
      </span>
    </li>
  );
}

export default function SubmitPage() {
  const [searchParams] = useSearchParams();
  const editingId = searchParams.get("extensionId");
  const isEditing = !!editingId;

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const toast = useKumoToastManager();
  const pollRef = useRef<number | null>(null);

  // Edit-mode state.
  const [editingExt, setEditingExt] = useState<Extension | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [history, setHistory] = useState<Submission[] | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const locked = busy || phase.kind === "generating";
  const ideas = isEditing ? EDIT_IDEAS : IDEAS;
  const typing = useTypewriter(ideas, prompt === "" && !locked);
  const workingWord = useRotating(WORKING_WORDS, phase.kind === "generating");

  // Load the target extension + its iteration history in edit mode. If an edit
  // is already being generated (possibly by another user), reflect it as an
  // in-progress state and watch it so the form unlocks when it resolves.
  useEffect(() => {
    if (!editingId) {
      setEditingExt(null);
      setHistory(null);
      setEditError(null);
      return;
    }
    let cancelled = false;
    setEditingExt(null);
    setEditError(null);
    setPhase({ kind: "idle" });

    api
      .getExtension(editingId)
      .then((r) => !cancelled && setEditingExt(r.extension))
      .catch(() => !cancelled && setEditError("Couldn't load this extension."));

    api
      .listExtensionSubmissions(editingId)
      .then((r) => {
        if (cancelled) return;
        const list = [...r.submissions].reverse();
        setHistory(list);
        const inFlight = findInFlight(list);
        if (inFlight) {
          setPhase({
            kind: "generating",
            extensionId: editingId,
            submissionId: inFlight.id,
          });
          startPolling(editingId, undefined, inFlight.id);
        }
      })
      .catch(() => !cancelled && setHistory([]));

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const refreshHistory = (id: string) => {
    api
      .listExtensionSubmissions(id)
      .then((r) => setHistory([...r.submissions].reverse()))
      .catch(() => setHistory([]));
  };

  // On a shipped edit: reload the preview, refresh history, clear the box.
  const onIterationShipped = () => {
    if (editingId) {
      setIframeKey((k) => k + 1);
      refreshHistory(editingId);
    }
    setPrompt("");
  };

  const startPolling = (
    extensionId: string,
    title?: string,
    submissionId?: string
  ) => {
    const started = Date.now();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        // We stopped *watching* — but the agent may still be generating.
        // Surface a recoverable "timed out" state, not a hard failure, so the
        // user can manually re-check once their connection is back.
        if (pollRef.current) clearInterval(pollRef.current);
        setPhase({ kind: "timedout", extensionId, submissionId, title });
        return;
      }
      try {
        // Iterations are tracked on the submission row (the live extension
        // stays "ready" the whole time). New builds track the extension row.
        if (submissionId) {
          const { submission } = await api.getSubmission(submissionId);
          const outcome = outcomeOf(submission.status);
          if (outcome === "ok") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase({ kind: "ready", extensionId, title });
            toast.add({
              title: "Update shipped",
              description: title ?? "",
              variant: "success",
            });
            onIterationShipped();
          } else if (outcome === "fail") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase({
              kind: "failed",
              title,
              reason: submission.reason ?? "The edit couldn't be applied.",
            });
            if (editingId) refreshHistory(editingId);
          }
        } else {
          const s = await api.getStatus(extensionId);
          if (s.status === "ready") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase({ kind: "ready", extensionId, title: s.title ?? title });
            toast.add({ title: "Ready", description: s.title ?? title ?? "", variant: "success" });
          } else if (s.status === "failed" || s.status === "rejected") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase({ kind: "failed", title: s.title ?? title, reason: s.reason ?? "Generation failed." });
          }
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
  };

  // Manual re-check after a timeout: do one immediate status fetch, then resume
  // polling if it's still working. Only a real server-side resolution flips us.
  const checkAgain = async (
    extensionId: string,
    title?: string,
    submissionId?: string
  ) => {
    setPhase({ kind: "generating", extensionId, submissionId, title });
    try {
      if (submissionId) {
        const { submission } = await api.getSubmission(submissionId);
        const outcome = outcomeOf(submission.status);
        if (outcome === "ok") {
          setPhase({ kind: "ready", extensionId, title });
          toast.add({ title: "Update shipped", description: title ?? "", variant: "success" });
          onIterationShipped();
          return;
        }
        if (outcome === "fail") {
          setPhase({ kind: "failed", title, reason: submission.reason ?? "The edit couldn't be applied." });
          if (editingId) refreshHistory(editingId);
          return;
        }
      } else {
        const s = await api.getStatus(extensionId);
        if (s.status === "ready") {
          setPhase({ kind: "ready", extensionId, title: s.title ?? title });
          toast.add({ title: "Ready", description: s.title ?? title ?? "", variant: "success" });
          return;
        }
        if (s.status === "failed" || s.status === "rejected") {
          setPhase({ kind: "failed", title: s.title ?? title, reason: s.reason ?? "Generation failed." });
          return;
        }
      }
    } catch {
      /* connection still flaky — fall through and resume polling */
    }
    startPolling(extensionId, title, submissionId);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setPhase({ kind: "idle" });
    try {
      const r = await api.submitPrompt(prompt.trim(), editingId ?? undefined);
      const b = r.body;
      if (r.status === 503) {
        setPhase({ kind: "error", message: b.message ?? "Classifier unavailable. Try again." });
      } else if (r.status === 409 && b.error === "iteration_in_progress") {
        // Someone got there first — re-lock and watch the in-flight edit.
        toast.add({
          title: "Already editing",
          description: b.message ?? "An edit is already in progress for this extension.",
          variant: "warning",
        });
        if (editingId) {
          try {
            const hr = await api.listExtensionSubmissions(editingId);
            const list = [...hr.submissions].reverse();
            setHistory(list);
            const inFlight = findInFlight(list);
            if (inFlight) {
              setPhase({ kind: "generating", extensionId: editingId, submissionId: inFlight.id });
              startPolling(editingId, editingExt?.title, inFlight.id);
            } else {
              setPhase({ kind: "idle" });
            }
          } catch {
            setPhase({ kind: "error", message: b.message ?? "An edit is already in progress." });
          }
        }
      } else if (r.status >= 400) {
        setPhase({ kind: "error", message: b.message ?? b.error ?? "Submission failed." });
      } else if (b.status === "rejected") {
        setPhase({ kind: "rejected", title: b.title, reason: b.reason });
        if (editingId) refreshHistory(editingId);
      } else if (b.status === "generating" && b.extension_id) {
        setPhase({
          kind: "generating",
          extensionId: b.extension_id,
          submissionId: isEditing ? b.submission_id : undefined,
          title: b.title,
        });
        startPolling(
          b.extension_id,
          b.title,
          isEditing ? b.submission_id : undefined
        );
        if (editingId) refreshHistory(editingId);
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

  // ---- Edit mode ----------------------------------------------------------
  if (isEditing) {
    return (
      <div className="relative min-h-screen">
        <div className="relative mx-auto max-w-5xl px-4 py-8 sm:py-12">
          <Link
            to="/extensions"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-kumo-subtle transition hover:text-white"
          >
            <ArrowLeftIcon size={16} /> All extensions
          </Link>

          <header className="mb-6">
            <p className="text-xs uppercase tracking-wide text-kumo-subtle">
              Continue editing
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              {editingExt?.title ?? "extension"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-kumo-subtle">
              Describe a change. The agent reads the current code, applies your
              tweak, tests it, and ships it. If an edit fails, your live version
              stays exactly as it is.
            </p>
          </header>

          {editError && (
            <div className="mb-6">
              <Banner variant="error" title="Couldn't load extension" description={editError} />
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Live preview */}
            <div className="order-2 lg:order-1">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Live preview</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIframeKey((k) => k + 1)}
                    className="inline-flex items-center gap-1 text-xs text-kumo-subtle transition hover:text-white"
                  >
                    <ArrowClockwiseIcon size={14} /> Reload
                  </button>
                  <a
                    href={`/x/${editingId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-kumo-link underline"
                  >
                    Open ↗
                  </a>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
                <iframe
                  key={iframeKey}
                  src={`/x/${editingId}`}
                  sandbox="allow-scripts"
                  title="extension preview"
                  className="w-full"
                  style={{ height: 520, border: "none" }}
                />
              </div>
            </div>

            {/* Edit form + status + history */}
            <div className="order-1 space-y-4 lg:order-2">
              <form onSubmit={onSubmit} className="space-y-3">
                <InputArea
                  placeholder={
                    prompt === "" && !locked
                      ? `${typing}\u258b`
                      : "Describe a change to this extension…"
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  disabled={locked}
                  className="min-h-[120px] w-full resize-none text-base"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs tabular-nums text-kumo-subtle">
                    {prompt.length} / 2000
                  </span>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={
                      locked ||
                      !prompt.trim() ||
                      !editingExt ||
                      editingExt.status !== "ready"
                    }
                    className="min-h-[44px] gap-1.5 px-6"
                  >
                    <SparkleIcon size={16} weight="fill" />
                    {busy ? "Submitting…" : "Apply change"}
                  </Button>
                </div>
              </form>

              {!locked && (
                <div className="flex flex-wrap gap-2">
                  {EDIT_IDEAS.slice(0, 4).map((idea) => (
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

              <StatusBlocks
                phase={phase}
                workingWord={workingWord}
                onCheckAgain={checkAgain}
                onReset={reset}
                editing
              />

              <div>
                <h2 className="mb-2 mt-2 text-sm font-medium">History</h2>
                {history === null ? (
                  <div className="flex justify-center py-6">
                    <Loader />
                  </div>
                ) : history.length === 0 ? (
                  <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-center text-sm text-kumo-subtle">
                    No edits yet. Your changes will show up here.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {history.map((s) => (
                      <HistoryRow key={s.id} s={s} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- New-build mode -----------------------------------------------------
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
          <StatusBlocks
            phase={phase}
            workingWord={workingWord}
            onCheckAgain={checkAgain}
            onReset={reset}
          />
        </div>
      </div>
    </div>
  );
}

// Shared status rendering for both new-build and edit modes.
function StatusBlocks({
  phase,
  workingWord,
  onCheckAgain,
  onReset,
  editing = false,
}: {
  phase: Phase;
  workingWord: string;
  onCheckAgain: (extensionId: string, title?: string, submissionId?: string) => void;
  onReset: () => void;
  editing?: boolean;
}) {
  return (
    <>
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
            <span key={workingWord} className="inline-block animate-fade-in-up font-medium">
              {workingWord}…
            </span>
            <span className="block text-xs text-kumo-subtle">
              {phase.title ? `${editing ? "Editing" : "Building"} “${phase.title}” — ` : ""}
              writing code, testing it in a sandbox, and committing. Usually under a minute.
            </span>
          </span>
        </div>
      )}

      {phase.kind === "ready" && !editing && (
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
              onClick={onReset}
              className="text-xs text-kumo-subtle underline hover:text-white"
            >
              Build another
            </button>
          </div>
        </div>
      )}

      {phase.kind === "ready" && editing && (
        <div className="animate-fade-in-up flex items-start gap-2.5 rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-4">
          <CheckCircleIcon size={20} weight="fill" className="mt-0.5 text-emerald-400" />
          <div>
            <p className="text-sm font-medium">Update shipped</p>
            <p className="text-xs text-kumo-subtle">The preview now shows your latest change.</p>
          </div>
        </div>
      )}

      {phase.kind === "timedout" && (
        <div className="animate-fade-in-up space-y-3">
          <Banner
            variant="alert"
            title="Still working…"
            description="This is taking longer than usual — likely a spotty connection, not a failure. It may still be in progress. Check again in a moment."
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => onCheckAgain(phase.extensionId, phase.title, phase.submissionId)}
              className="gap-1.5"
            >
              <SparkleIcon size={16} weight="fill" />
              Check again
            </Button>
            <Button variant="secondary" onClick={onReset}>
              Start over
            </Button>
          </div>
        </div>
      )}

      {phase.kind === "failed" && (
        <div className="animate-fade-in-up space-y-3">
          <Banner
            variant="error"
            title={`${editing ? "Edit failed" : "Generation failed"}${phase.title ? `: ${phase.title}` : ""}`}
            description={
              phase.reason ??
              (editing
                ? "The agent couldn't apply that change. Your live version is unchanged."
                : "The agent couldn't produce a working build.")
            }
          />
          {editing && (
            <p className="text-xs text-kumo-subtle">
              Your live version is untouched — try describing the change differently.
            </p>
          )}
          {!editing && (
            <Button variant="secondary" onClick={onReset}>
              Try again
            </Button>
          )}
        </div>
      )}

      {phase.kind === "error" && (
        <div className="animate-fade-in-up">
          <Banner variant="error" title="Something went wrong" description={phase.message} />
        </div>
      )}
    </>
  );
}
