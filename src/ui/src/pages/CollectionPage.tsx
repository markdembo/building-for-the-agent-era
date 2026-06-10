import { useEffect, useMemo, useState } from "react";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Input } from "@cloudflare/kumo/components/input";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { api, type Record } from "../lib/api";
import { RecordCard } from "../components/RecordCard";
import { RecordDialog } from "../components/RecordDialog";

const NOW_SPINNING_DAYS = 30;

export default function CollectionPage() {
  const [records, setRecords] = useState<Record[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Record | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listRecords()
      .then((r) => {
        if (!cancelled) setRecords(r.records);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!records) return [];
    let rows = records;
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.artist.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q)
      );
    }
    if (filter === "spinning") {
      const cutoff = Date.now() - NOW_SPINNING_DAYS * 24 * 60 * 60 * 1000;
      rows = rows.filter((r) => new Date(r.dateAdded).getTime() >= cutoff);
    } else if (filter !== "all") {
      rows = rows.filter((r) =>
        r.genres.some((g) => g.toLowerCase().includes(filter))
      );
    }
    return rows;
  }, [records, query, filter]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Vinyl Collection
        </h1>
        <p className="mt-2 text-sm text-kumo-subtle">
          {records ? `${records.length} records` : "Loading…"}
        </p>
      </header>

      <div className="mb-6">
        <Banner
          variant="default"
          title="This app's UI is just 'extension zero'"
          description="Audience members will prompt their own views into existence."
        />
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          variant="segmented"
          size="sm"
          value={filter}
          onValueChange={setFilter}
          tabs={[
            { value: "all", label: "All" },
            { value: "spinning", label: "Now spinning" },
            { value: "rock", label: "Rock" },
            { value: "electronic", label: "Electronic" },
            { value: "jazz", label: "Jazz" },
            { value: "soul", label: "Soul / Funk" },
          ]}
        />
        <div className="w-full sm:w-72">
          <Input
            placeholder="Search artist or title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-kumo-danger-tint bg-kumo-danger-tint/30 p-4 text-sm text-kumo-danger">
          Failed to load: {error}
        </div>
      ) : !records ? (
        <div className="flex items-center justify-center py-24">
          <Loader />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-kumo-fill bg-kumo-elevated p-12 text-center text-kumo-subtle">
          No records match.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((r) => (
            <RecordCard
              key={r.id}
              record={r}
              onOpen={(rec) => setSelected(rec)}
            />
          ))}
        </div>
      )}

      <RecordDialog
        record={selected}
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}
