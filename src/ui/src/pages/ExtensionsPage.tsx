import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Table } from "@cloudflare/kumo/components/table";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Badge } from "@cloudflare/kumo/components/badge";
import { PuzzlePieceIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { api, type Extension } from "../lib/api";

const STATUS_VARIANT: Record<Extension["status"], "success" | "info" | "warning" | "error" | "neutral"> = {
  ready: "success",
  generating: "info",
  pending: "warning",
  failed: "error",
  rejected: "neutral",
};

export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState<Extension[] | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.listExtensions().then((r) => setExtensions(r.extensions)).catch(() => setExtensions([]));
  }, []);

  // Poll which extensions currently have an in-flight generation so we can hide
  // the Edit link and avoid concurrent edits from multiple staff at once.
  useEffect(() => {
    let active = true;
    const poll = () =>
      api
        .listPendingExtensions()
        .then((r) => active && setPending(new Set(r.ids)))
        .catch(() => {});
    poll();
    const t = window.setInterval(poll, 3000);
    return () => {
      active = false;
      window.clearInterval(t);
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Extensions</h1>
        <p className="mt-1 text-sm text-kumo-subtle">
          Audience-generated views of the collection. Each one runs in its own sandboxed Worker.
        </p>
      </header>

      {extensions && extensions.length === 0 ? (
        <div className="rounded-xl border border-kumo-fill bg-kumo-elevated p-6">
          <Empty
            icon={<PuzzlePieceIcon size={48} />}
            title="None yet — soon you'll prompt your own."
            description="At the talk, this page will fill in with audience-generated extensions."
          />
        </div>
      ) : (
        <div className="rounded-xl border border-kumo-fill overflow-hidden">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Title</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Created</Table.Head>
                <Table.Head>Edit</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {(extensions ?? []).map((e) => (
                <Table.Row key={e.id}>
                  <Table.Cell>
                    <a className="text-kumo-link underline" href={`/x/${e.id}`}>
                      {e.title}
                    </a>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant={STATUS_VARIANT[e.status]}>{e.status}</Badge>
                  </Table.Cell>
                  <Table.Cell>{new Date(e.created_at).toLocaleString()}</Table.Cell>
                  <Table.Cell>
                    {e.status === "ready" && pending.has(e.id) ? (
                      <span className="text-xs text-kumo-subtle">editing…</span>
                    ) : e.status === "ready" ? (
                      <Link
                        to={`/submit?extensionId=${e.id}`}
                        className="inline-flex items-center gap-1 text-kumo-link underline"
                      >
                        <PencilSimpleIcon size={14} /> Edit
                      </Link>
                    ) : (
                      <span className="text-kumo-subtle">—</span>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
    </div>
  );
}
