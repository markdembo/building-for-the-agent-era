import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Table } from "@cloudflare/kumo/components/table";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { Empty } from "@cloudflare/kumo/components/empty";
import { useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { PuzzlePieceIcon } from "@phosphor-icons/react";
import { api, type Extension, type Submission } from "../lib/api";

const STATUS_VARIANT: Record<
  Extension["status"],
  "success" | "info" | "warning" | "error" | "neutral"
> = {
  ready: "success",
  generating: "warning",
  pending: "warning",
  failed: "error",
  rejected: "neutral",
};

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function short(s: string | null, n = 12): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default function AdminPage() {
  const navigate = useNavigate();
  const toast = useKumoToastManager();
  const [tab, setTab] = useState("extensions");
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const readyIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const [ex, sub] = await Promise.all([
          api.listExtensions(true),
          api.listSubmissions(),
        ]);
        if (!active) return;
        // Toast on newly-ready extensions.
        const nowReady = new Set(
          ex.extensions.filter((e) => e.status === "ready").map((e) => e.id)
        );
        if (readyIds.current) {
          for (const e of ex.extensions) {
            if (e.status === "ready" && !readyIds.current.has(e.id)) {
              toast.add({
                title: "New extension ready",
                description: e.title,
                variant: "success",
              });
            }
          }
        }
        readyIds.current = nowReady;
        setExtensions(ex.extensions);
        setSubmissions(sub.submissions);
      } catch {
        /* ignore transient errors */
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [toast]);

  const live = extensions.filter((e) => e.status !== "rejected");
  const rejected = extensions.filter((e) => e.status === "rejected");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Extension Admin</h1>
        <p className="mt-1 text-sm text-kumo-subtle">
          Everything audience members are prompting into existence.
        </p>
        <div className="mt-4">
          <Tabs
            variant="underline"
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: "extensions", label: `Extensions (${live.length})` },
              { value: "submissions", label: `Submissions (${submissions.length})` },
              { value: "rejected", label: `Rejected (${rejected.length})` },
            ]}
          />
        </div>
      </header>

      {tab === "extensions" && (
        <ExtensionsTable rows={live} onOpen={(id) => navigate(`/admin/extensions/${id}`)} />
      )}
      {tab === "submissions" && <SubmissionsTable rows={submissions} />}
      {tab === "rejected" && <RejectedTable rows={rejected} />}
    </div>
  );
}

function ExtensionsTable({
  rows,
  onOpen,
}: {
  rows: Extension[];
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-kumo-fill bg-kumo-elevated p-6">
        <Empty
          icon={<PuzzlePieceIcon size={48} />}
          title="No extensions yet"
          description="Submitted prompts will appear here as they generate."
        />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-kumo-fill overflow-hidden">
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.Head>Title</Table.Head>
            <Table.Head>Prompt</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Artifact Ref</Table.Head>
            <Table.Head>Last Commit</Table.Head>
            <Table.Head>Created</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((e) => (
            <Table.Row
              key={e.id}
              className="cursor-pointer"
              onClick={() => onOpen(e.id)}
            >
              <Table.Cell>{e.title}</Table.Cell>
              <Table.Cell>
                <span className="text-kumo-subtle" title={e.prompt}>
                  {e.prompt.length > 60 ? e.prompt.slice(0, 60) + "…" : e.prompt}
                </span>
              </Table.Cell>
              <Table.Cell>
                <Badge variant={STATUS_VARIANT[e.status]}>{e.status}</Badge>
              </Table.Cell>
              <Table.Cell>
                <span className="font-mono text-xs">{short(e.artifact_ref, 20)}</span>
              </Table.Cell>
              <Table.Cell>
                <span className="font-mono text-xs">
                  {e.last_commit_sha ? e.last_commit_sha.slice(0, 7) : "—"}{" "}
                  {short(e.last_commit_message, 24)}
                </span>
              </Table.Cell>
              <Table.Cell>{relTime(e.created_at)}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </div>
  );
}

function SubmissionsTable({ rows }: { rows: Submission[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-kumo-subtle">No submissions yet.</p>;
  }
  return (
    <div className="rounded-xl border border-kumo-fill overflow-hidden">
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.Head>Prompt</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Created</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((s) => (
            <Table.Row key={s.id}>
              <Table.Cell>
                <span title={s.prompt}>
                  {s.prompt.length > 80 ? s.prompt.slice(0, 80) + "…" : s.prompt}
                </span>
              </Table.Cell>
              <Table.Cell>
                <Badge variant="neutral">{s.status}</Badge>
              </Table.Cell>
              <Table.Cell>{relTime(s.created_at)}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </div>
  );
}

function RejectedTable({ rows }: { rows: Extension[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-kumo-subtle">No rejections yet.</p>;
  }
  return (
    <div className="space-y-3">
      {rows.map((e) => (
        <Banner
          key={e.id}
          variant="error"
          title={e.title}
          description={
            <span>
              <span className="block italic text-kumo-subtle">“{e.prompt}”</span>
              {e.reason ?? "Rejected."}
            </span>
          }
        />
      ))}
    </div>
  );
}
