// Genre → Badge variant mapping. Case-insensitive match against any token
// in the genre array; first hit wins.

export type BadgeVariant =
  | "purple"
  | "blue"
  | "orange"
  | "teal"
  | "neutral";

const RULES: Array<[RegExp, BadgeVariant]> = [
  [/electronic|electronica|techno|house/i, "purple"],
  [/jazz/i, "blue"],
  [/rock|metal|punk|indie/i, "orange"],
  [/soul|funk|r&b|rnb/i, "teal"],
];

export function genreVariant(genres: string[] | null | undefined): BadgeVariant {
  if (!genres) return "neutral";
  for (const g of genres) {
    for (const [re, variant] of RULES) {
      if (re.test(g)) return variant;
    }
  }
  return "neutral";
}
