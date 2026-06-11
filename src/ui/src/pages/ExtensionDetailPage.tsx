import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { Table } from "@cloudflare/kumo/components/table";
import { Loader } from "@cloudflare/kumo/components/loader";
import { CodeHighlighted, ShikiProvider } from "@cloudflare/kumo/code";
import { api, type Extension, type Commit } from "../lib/api";

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

export default function ExtensionDetailPage() {
  const { id = "" } = useParams();
  const [ext, setExt] = useState<Extension | null>(null);
  const [tab, setTab] = useState("preview");
  const [code, setCode] = useState<string | null>(null);
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    api.getExtension(id).then((r) => setExt(r.extension)).catch(() => setExt(null));
  }, [id]);

  useEffect(() => {
    if (tab === "code" && code === null) {
      api.getCode(id).then((r) => setCode(r.html)).catch(() => setCode("// failed to load source"));
    }
    if (tab === "commits" && commits === null) {
      api.getCommits(id).then((r) => setCommits(r.commits)).catch(() => setCommits([]));
    }
  }, [tab, id, code, commits]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-6">
        <Link to="/admin" className="text-xs text-kumo-link underline">
          ← Back to admin
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {ext?.title ?? id}
          </h1>
          {ext && <Badge variant={STATUS_VARIANT[ext.status]}>{ext.status}</Badge>}
        </div>
        {ext?.prompt && (
          <p className="mt-1 text-sm text-kumo-subtle">{ext.prompt}</p>
        )}
        <div className="mt-4">
          <Tabs
            variant="underline"
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: "preview", label: "Preview" },
              { value: "code", label: "Code" },
              { value: "commits", label: "Commit History" },
            ]}
          />
        </div>
      </header>

      {tab === "preview" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setIframeKey((k) => k + 1)}>
              Reload
            </Button>
          </div>
          <div className="rounded-xl border border-kumo-fill overflow-hidden bg-black">
            <iframe
              key={iframeKey}
              src={`/x/${id}`}
              sandbox="allow-scripts"
              title="extension preview"
              className="w-full"
              style={{ height: 640, border: "none" }}
            />
          </div>
        </div>
      )}

      {tab === "code" &&
        (code === null ? (
          <Loader />
        ) : (
          <div className="rounded-xl border border-kumo-fill overflow-hidden">
            <ShikiProvider engine="javascript" languages={["javascript"]}>
              <CodeHighlighted code={code} lang="javascript" showLineNumbers showCopyButton />
            </ShikiProvider>
          </div>
        ))}

      {tab === "commits" &&
        (commits === null ? (
          <Loader />
        ) : commits.length === 0 ? (
          <p className="text-sm text-kumo-subtle">No commits.</p>
        ) : (
          <div className="rounded-xl border border-kumo-fill overflow-hidden">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.Head>SHA</Table.Head>
                  <Table.Head>Message</Table.Head>
                  <Table.Head>Author</Table.Head>
                  <Table.Head>When</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {commits.map((c) => (
                  <Table.Row key={c.sha}>
                    <Table.Cell>
                      <span className="font-mono text-xs">{c.sha.slice(0, 7)}</span>
                    </Table.Cell>
                    <Table.Cell>{c.message}</Table.Cell>
                    <Table.Cell>{c.author}</Table.Cell>
                    <Table.Cell>{new Date(c.timestamp).toLocaleString()}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        ))}
    </div>
  );
}
