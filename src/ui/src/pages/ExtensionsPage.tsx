import { useEffect, useState } from "react";
import { Table } from "@cloudflare/kumo/components/table";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Badge } from "@cloudflare/kumo/components/badge";
import { PuzzlePieceIcon } from "@phosphor-icons/react";
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

  useEffect(() => {
    api.listExtensions().then((r) => setExtensions(r.extensions)).catch(() => setExtensions([]));
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
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
    </div>
  );
}
