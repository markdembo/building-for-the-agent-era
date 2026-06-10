/**
 * scripts/seed.ts
 *
 * Reads vinyl-data.json and INSERT OR REPLACE's each row into D1 (`records`)
 * via `wrangler d1 execute --remote`. Idempotent — safe to re-run.
 *
 * Usage:  npm run seed
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

type Record = {
  id: number;
  artist: string;
  title: string;
  year?: number | null;
  genres?: string[];
  styles?: string[];
  format?: string | null;
  vinylColor?: string | null;
  coverImage: string;
  thumbnail: string;
  discogsUrl?: string | null;
  rating?: number | null;
  dateAdded: string;
};

const DB_BINDING = "DB";
const DATA_FILE = "vinyl-data.json";
const BATCH_SIZE = 25;

function sqlQuote(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function buildStatement(records: Record[]): string {
  const rows = records.map((r) => {
    return `(${[
      sqlQuote(r.id),
      sqlQuote(r.artist),
      sqlQuote(r.title),
      sqlQuote(typeof r.year === "number" ? r.year : null),
      sqlQuote(JSON.stringify(r.genres ?? [])),
      sqlQuote(JSON.stringify(r.styles ?? [])),
      sqlQuote(r.format ?? null),
      sqlQuote(r.vinylColor ?? null),
      sqlQuote(r.coverImage),
      sqlQuote(r.thumbnail),
      sqlQuote(r.discogsUrl ?? null),
      sqlQuote(typeof r.rating === "number" ? r.rating : null),
      sqlQuote(r.dateAdded),
    ].join(", ")})`;
  });
  return (
    "INSERT OR REPLACE INTO records " +
    "(id, artist, title, year, genres, styles, format, vinyl_color, cover_image, thumbnail, discogs_url, rating, date_added) " +
    "VALUES\n" +
    rows.join(",\n") +
    ";"
  );
}

function main() {
  const local = process.argv.includes("--local");
  const data: Record[] = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  console.log(`Seeding ${data.length} records into D1 (${local ? "local" : "remote"})...`);

  const dir = mkdtempSync(join(tmpdir(), "vinyl-seed-"));
  let totalRows = 0;

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    const sql = buildStatement(batch);
    const file = join(dir, `batch-${i}.sql`);
    writeFileSync(file, sql);

    const args = [
      "wrangler",
      "d1",
      "execute",
      DB_BINDING,
      local ? "--local" : "--remote",
      "--file",
      file,
      "--yes",
    ];
    const result = spawnSync("npx", args, { stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`Batch ${i / BATCH_SIZE + 1} failed.`);
      process.exit(1);
    }
    totalRows += batch.length;
    console.log(`  ✓ ${totalRows}/${data.length}`);
  }

  console.log(`\nSeed complete — ${totalRows} records.`);
}

main();
