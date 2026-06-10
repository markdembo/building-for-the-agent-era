import { useState } from "react";
import { Button } from "@cloudflare/kumo/components/button";
import { InputArea } from "@cloudflare/kumo/components/input";
import { Banner } from "@cloudflare/kumo/components/banner";
import { useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { api } from "../lib/api";

export default function SubmitPage() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<
    | null
    | {
        status: number;
        message?: string;
        error?: string;
      }
  >(null);
  const toast = useKumoToastManager();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setResponse(null);
    try {
      const r = await api.submitPrompt(prompt.trim());
      setResponse({ status: r.status, message: r.body.message, error: r.body.error });
      if (r.status === 501) {
        toast.add({
          title: "Not yet — come to the talk",
          description: "The platform doesn't exist yet. We'll build it live on stage.",
          variant: "info",
        });
      } else if (r.status >= 400) {
        toast.add({
          title: "Submission failed",
          description: r.body.error ?? "Unknown error",
          variant: "error",
        });
      } else {
        toast.add({
          title: "Received",
          description: "Your prompt is being generated.",
          variant: "success",
        });
      }
    } catch (err) {
      toast.add({
        title: "Network error",
        description: String(err),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Prompt an extension
        </h1>
        <p className="mt-2 text-sm text-kumo-subtle">
          Describe a change to this app. An agent will build it as a personal view for you.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-4">
        <InputArea
          placeholder="e.g. make the album covers spin slowly"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          maxLength={2000}
          disabled={busy}
          className="min-h-[140px] text-base"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-kumo-subtle">
            {prompt.length} / 2000
          </span>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !prompt.trim()}
            className="min-h-[44px] px-6"
          >
            {busy ? "Submitting…" : "Generate"}
          </Button>
        </div>
      </form>

      {response && response.status === 501 ? (
        <div className="mt-6">
          <Banner
            variant="secondary"
            title="The platform doesn't exist yet"
            description="Come to the talk — we'll build it live on stage."
          />
        </div>
      ) : null}
    </div>
  );
}
