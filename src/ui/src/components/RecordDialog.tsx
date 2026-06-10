import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { type Record } from "../lib/api";
import { genreVariant } from "../lib/genres";

export function RecordDialog({
  record,
  open,
  onOpenChange,
}: {
  record: Record | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size="xl" className="p-6">
        {record ? (
          <div className="space-y-5">
            <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
              <img
                src={record.coverImage}
                alt={record.title}
                className="aspect-square w-full rounded-md object-cover ring-1 ring-black/40"
                loading="lazy"
              />
              <div className="space-y-3">
                <div>
                  <Dialog.Title className="text-xl font-semibold">
                    {record.title}
                  </Dialog.Title>
                  <Dialog.Description className="text-kumo-subtle">
                    {record.artist}
                  </Dialog.Description>
                </div>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-kumo-subtle">Year</dt>
                  <dd>{record.year ?? "—"}</dd>
                  <dt className="text-kumo-subtle">Genres</dt>
                  <dd className="flex flex-wrap gap-1">
                    {record.genres.map((g) => (
                      <Badge key={g} variant={genreVariant([g])}>{g}</Badge>
                    ))}
                  </dd>
                  <dt className="text-kumo-subtle">Styles</dt>
                  <dd>{record.styles.join(", ") || "—"}</dd>
                  <dt className="text-kumo-subtle">Format</dt>
                  <dd>{record.format ?? "—"}</dd>
                  <dt className="text-kumo-subtle">Color</dt>
                  <dd>{record.vinylColor ?? "—"}</dd>
                  <dt className="text-kumo-subtle">Rating</dt>
                  <dd>
                    {record.rating
                      ? "★".repeat(record.rating) + "☆".repeat(5 - record.rating)
                      : "—"}
                  </dd>
                  <dt className="text-kumo-subtle">Added</dt>
                  <dd>{new Date(record.dateAdded).toLocaleDateString()}</dd>
                </dl>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-kumo-fill pt-4">
              {record.discogsUrl ? (
                <a
                  href={record.discogsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-kumo-link underline"
                >
                  View on Discogs ↗
                </a>
              ) : <span />}
              <Dialog.Close
                render={(p) => <Button variant="secondary" {...p}>Close</Button>}
              />
            </div>
          </div>
        ) : null}
      </Dialog>
    </Dialog.Root>
  );
}
