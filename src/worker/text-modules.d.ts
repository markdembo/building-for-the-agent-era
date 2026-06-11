// Markdown prompt files are loaded as Text modules (see the `rules` entry in
// wrangler.jsonc). Importing one yields its raw contents as a string.
declare module "*.md" {
  const content: string;
  export default content;
}
