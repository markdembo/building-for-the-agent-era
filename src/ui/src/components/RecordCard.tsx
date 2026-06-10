import { LayerCard } from "@cloudflare/kumo/components/layer-card";
import { Badge } from "@cloudflare/kumo/components/badge";
import { type Record } from "../lib/api";
import { genreVariant } from "../lib/genres";

export function RecordCard({
  record,
  onOpen,
}: {
  record: Record;
  onOpen: (r: Record) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(record)}
      className="card-lift group block w-full text-left"
    >
      <LayerCard className="overflow-hidden rounded-xl ring-1 ring-black/20">
        <div className="relative aspect-square w-full overflow-hidden bg-kumo-fill">
          <img
            src={record.coverImage}
            alt={record.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = record.thumbnail;
            }}
          />
        </div>
        <div className="space-y-2 p-3">
          <LayerCard.Secondary className="truncate text-xs text-kumo-subtle">
            {record.artist}
          </LayerCard.Secondary>
          <LayerCard.Primary className="line-clamp-2 text-sm font-medium leading-tight">
            {record.title}
          </LayerCard.Primary>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-kumo-subtle">{record.year ?? ""}</span>
            <div className="flex flex-wrap items-center justify-end gap-1">
              {record.genres.slice(0, 2).map((g) => (
                <Badge key={g} variant={genreVariant([g])}>
                  {g}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </LayerCard>
    </button>
  );
}
